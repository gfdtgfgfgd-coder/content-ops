"""Revise one saved image or copy through generate.py revise; never overwrite originals."""
from __future__ import annotations
import argparse
import base64
import io
import json
from pathlib import Path
import re
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from PIL import Image, ImageOps, ImageDraw
from . import gateway, words

ROOT = Path(__file__).resolve().parents[2]


def regenerate_image(data, settings, output):
    from . import copy, backgrounds
    prompt = data.get('prompt')
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>16000 or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',prompt):
        raise ValueError('提示词须为1–16000字，不能含控制字符')
    if output.exists():
        raise ValueError('修改结果文件已存在，拒绝覆盖')
    mode = data.get('render_mode')
    if mode not in ('direct_poster','layered_poster'):
        raise ValueError('重新生成方式无效')
    copy.check_cover_words(copy.positive_visual_text(prompt),data['platform'],data['model'],context='生图提示词')
    style, texts = None, []
    if mode == 'layered_poster':
        copy.check_bold_typo_subject(copy.positive_visual_text(prompt))
        texts = data.get('cover_texts')
        plan = {'collection_name':'大字报','structure':{},'cover_texts':texts,'visual_prompt':'满幅平面背景'}
        copy.validate_visual_plan(plan,data['model'],data['platform'])
        style = backgrounds.normalize_style(data.get('background_style'))
        font = next((path for path in [Path(settings.get('CONTENT_OPS_FONT','missing-font')),
                    Path.home()/'Library/Fonts/SourceHanSansSC-Medium.otf',Path('/System/Library/Fonts/Hiragino Sans GB.ttc')] if path.is_file()),None)
        if font is None:
            raise ValueError('未找到中文字体，请配置CONTENT_OPS_FONT')
    size = copy.poster_size(data['platform'])
    background = Path(data['background_path']) if data.get('background_path') else output.with_name(output.stem+'-background.png')
    if background.exists():
        raise ValueError('背景结果文件已存在，拒绝覆盖')
    try:
        result = gateway.generate_image(prompt=prompt,output=background if mode=='layered_poster' else output,
            model=settings['CONTENT_OPS_IMAGE_MODEL'],base_url=settings['CONTENT_OPS_BASE_URL'],api_key=settings['CONTENT_OPS_API_KEY'],
            size=f'{size[0]}x{size[1]}',timeout=240)
        if (result['width'],result['height']) != size:
            raise ValueError('图像模型返回画幅不符；未采用，不自动重试')
        rendered = copy.render_bold_typo(background,output,texts,font,size,style,preserve_background=True) if mode=='layered_poster' else {}
        return {**result,**rendered,'prompt':prompt,'renderMode':mode,'coverTexts':texts,'backgroundStyle':style,
                'imageRequest':{'prompt':prompt,'model':result['model'],'size':f'{size[0]}x{size[1]}','mode':mode,'status':'completed'}}
    finally:
        background.unlink(missing_ok=True)


def validate_copy(text, platform, model):
    if not isinstance(text, str) or not text.strip() or len(text) > 18000 or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
        raise ValueError('文案须为非空文本，最多18000字，不能含控制字符')
    text = text.strip()
    title = re.sub(r'^#{1,6}\s*', '', text.splitlines()[0]).strip()
    if not title or len(title) > (20 if platform == 'xhs' else 80):
        raise ValueError('标题过长：小红书最多20字，闲鱼最多80字')
    hits = words.check(text, platform, model)
    if hits:
        raise ValueError('文案包含风险词：' + '、'.join(sorted({hit['word'] for hit in hits})))
    return text


def revise_copy(data, settings):
    if data['action'] == 'manual':
        return {'text': validate_copy(data.get('text'), data['platform'], data['model'])}
    from .preferences import load_preferences
    preference, _, _, _, _ = load_preferences(ROOT/'data/distilled-preferences.json', data['platform'], 26000)
    prompt = ('修改下方这一篇文案，保留未要求修改的事实、型号、价格和信息。'
              '只允许使用原文、当前简报、已核验事实和用户本次明确提供的资料，不新增实测、库存或效果承诺。'
              '遵守当前内容规范和风险词，不照搬参考帖事实。只返回JSON对象，text字段是完整Markdown文案，'
              '第一行是标题，随后是正文和标签。修改只影响当前文案版本。\n' + preference)
    response = gateway.request_json(settings['CONTENT_OPS_BASE_URL'].rstrip('/')+'/chat/completions', {
        'model': settings['CONTENT_OPS_TEXT_MODEL'], 'messages': [
            {'role': 'system', 'content': prompt},
            {'role': 'user', 'content': json.dumps({key: data.get(key) for key in
              ('platform', 'model', 'source_text', 'brief', 'facts', 'instructions')}, ensure_ascii=False)}],
        'max_tokens': 8000, 'temperature': 0.4, 'response_format': {'type': 'json_object'}
    }, settings['CONTENT_OPS_API_KEY'], 180)
    choice = response.get('choices', [{}])[0]
    if choice.get('finish_reason') == 'length':
        raise ValueError('改写文案被截断，原稿已保留；可缩短修改要求后重试')
    raw = choice.get('message', {}).get('content', '').strip()
    raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw)
    try:
        text = json.loads(raw)['text']
    except (ValueError, KeyError, TypeError):
        raise ValueError('改写模型未返回完整文案，原稿已保留') from None
    return {'text': validate_copy(text, data['platform'], data['model']),
            'model': settings['CONTENT_OPS_TEXT_MODEL'], 'usage': response.get('usage', {})}


def multipart_request(url, fields, files, key, timeout=240):
    boundary = 'hanabi-' + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, filename, mime, content in files:
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode(), content, b'\r\n'])
    parts.append(f'--{boundary}--\r\n'.encode())
    request = Request(url, data=b''.join(parts), headers={
        'Authorization': 'Bearer ' + key, 'Content-Type': 'multipart/form-data; boundary=' + boundary}, method='POST')
    try:
        with urlopen(request, timeout=timeout) as response:
            result = json.load(response)
    except HTTPError as error:
        # Do not expose provider bodies: they may include echoed credentials or input images.
        if error.code in (400, 404, 405, 415, 422, 501):
            raise ValueError(f'改图接口拒绝请求（HTTP {error.code}）：请确认当前图像模型支持 /images/edits 及图片输入；原图已保留') from None
        raise ValueError(f'改图请求失败（HTTP {error.code}），请检查网关权限与额度；原图已保留') from None
    except (URLError, TimeoutError):
        raise ValueError('改图请求超时或网络不可达；不会自动重试，原图已保留') from None
    if not isinstance(result, dict) or result.get('error'):
        raise ValueError('改图网关返回错误；原图已保留')
    return result


def revise_image(data, settings, output):
    if output.exists():
        raise ValueError('修改结果文件已存在，拒绝覆盖')
    with Image.open(data['source_image']) as source:
        source.load()
        original = ImageOps.exif_transpose(source).convert('RGBA')
    size = original.size
    if data['action'] == 'upload':
        raw = data.get('image_data', '')
        raw = raw.split(',', 1)[1] if raw.startswith('data:image/') else raw
        try:
            binary = base64.b64decode(raw, validate=True)
            if len(binary) > 15 * 1024 * 1024:
                raise ValueError('图片最多15MB')
            with Image.open(io.BytesIO(binary)) as image:
                if image.width*image.height > 20000000:
                    raise ValueError('图片尺寸过大，最多2000万像素')
                image.load()
                revised = ImageOps.pad(ImageOps.exif_transpose(image).convert('RGB'), size, color='white')
        except (OSError, ValueError) as error:
            raise ValueError('替换图片无效或超过限制：' + str(error)) from None
        usage = {}
        model = 'manual-upload'
    else:
        buffer = io.BytesIO()
        original.save(buffer, format='PNG')
        files = [('image', 'source.png', 'image/png', buffer.getvalue())]
        region = data.get('region')
        if region:
            if any(not isinstance(region.get(k), (int, float)) for k in ('x', 'y', 'width', 'height')) or not (
                    0 <= region['x'] < 1 and 0 <= region['y'] < 1 and region['width'] > 0 and region['height'] > 0
                    and region['x']+region['width'] <= 1.000001 and region['y']+region['height'] <= 1.000001):
                raise ValueError('修改区域无效')
            mask = Image.new('RGBA', size, (255, 255, 255, 255))
            x, y = int(region['x']*size[0]), int(region['y']*size[1])
            right = min(size[0]-1, max(x, int((region['x']+region['width'])*size[0])-1))
            bottom = min(size[1]-1, max(y, int((region['y']+region['height'])*size[1])-1))
            ImageDraw.Draw(mask).rectangle((x, y, right, bottom), fill=(0, 0, 0, 0))
            mask_buffer = io.BytesIO()
            mask.save(mask_buffer, format='PNG')
            files.append(('mask', 'mask.png', 'image/png', mask_buffer.getvalue()))
        prompt = ('修改输入海报。保持原始画幅和未被要求修改的文字、内容与布局，不新增产品事实或价格。'
                  + ('仅修改透明蒙版区域，区域外保持原样。' if region else '')
                  + '\n当前平台：' + data['platform'] + '\n修改要求：' + data['instructions']
                  + '\n当前内容规范：\n' + (ROOT/'rules/content-spec.md').read_text())
        response = multipart_request(settings['CONTENT_OPS_BASE_URL'].rstrip('/')+'/images/edits',
            {'model': settings['CONTENT_OPS_IMAGE_MODEL'], 'prompt': prompt, 'n': '1',
             'size': settings.get('CONTENT_OPS_EDIT_IMAGE_SIZE', 'auto')}, files, settings['CONTENT_OPS_API_KEY'])
        kind, value = gateway.image_reference(response)
        binary = gateway.read_image(kind, value, 180)
        with Image.open(io.BytesIO(binary)) as image:
            image.load()
            revised = ImageOps.pad(image.convert('RGB'), size, color='white')
        if region:
            # Enforce region boundaries locally even if the provider ignores its mask.
            revised = Image.composite(original.convert('RGB'), revised, mask.getchannel('A'))
        usage, model = response.get('usage', {}), settings['CONTENT_OPS_IMAGE_MODEL']
    buffer = io.BytesIO()
    revised.save(buffer, format='PNG')
    return {**gateway.write_image(buffer.getvalue(), output), 'model': model, 'usage': usage}


def run(data, settings, image_output=None):
    if data.get('kind') not in ('copy', 'image') or data.get('platform') not in ('xhs', 'xianyu'):
        raise ValueError('修改类型或平台无效')
    if data['action'] in ('ai','regenerate'):
        if not settings.get('CONTENT_OPS_BASE_URL', '').startswith('https://') or not settings.get('CONTENT_OPS_API_KEY'):
            raise ValueError('请先配置网关HTTPS地址与密钥')
    if data['action'] == 'ai':
        if not isinstance(data.get('instructions'), str) or not 1 <= len(data['instructions'].strip()) <= 2000:
            raise ValueError('修改要求须为1–2000字')
    if data['kind'] == 'copy' and data['action'] in ('manual', 'ai'):
        return revise_copy(data, settings)
    if data['kind']=='image' and data['action']=='regenerate' and image_output:
        return regenerate_image(data,settings,image_output)
    if data['kind'] == 'image' and data['action'] in ('upload', 'ai') and image_output:
        return revise_image(data, settings, image_output)
    raise ValueError('修改操作无效')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--image-output', type=Path)
    parser.add_argument('--config', type=Path, default=ROOT/'scratch/gateway.env')
    args = parser.parse_args(argv)
    try:
        result = run(json.loads(args.input.read_text()), gateway.load_config(args.config), args.image_output)
        args.output.write_text(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        key = gateway.load_config(args.config).get('CONTENT_OPS_API_KEY', '')
        args.output.write_text(json.dumps({'error': gateway.safe_error(str(error), key)}, ensure_ascii=False))
        return 1
