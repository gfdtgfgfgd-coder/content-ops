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


def validate_edited_cover_texts(texts, platform, model):
    """Manual cover edits keep user wording rather than generation-only contracts."""
    from . import copy
    if not isinstance(texts, list) or not 3 <= len(texts) <= 4:
        raise ValueError('请填写3～4行封面文字')
    for index, item in enumerate(texts, 1):
        if (not isinstance(item, dict) or item.get('role') not in ('hook', 'benefit', 'model', 'payoff')
                or not isinstance(item.get('text'), str) or not item['text'].strip()
                or len(item['text']) > 80 or re.search(r'[\x00-\x1f\x7f]', item['text'])):
            raise ValueError('封面文字须为1～80字的有效单行文本')
        copy.normalize_line_scale(item.get('scale', 1))
        copy.check_cover_words(item['text'], platform, model, context=f'封面短字第{index}项')
    return texts


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
    typography = copy.normalize_typography(data.get('typography'))
    color_grade = copy.normalize_color_grade(data.get('color_grade'))
    style, texts = None, []
    if mode == 'layered_poster':
        copy.check_bold_typo_subject(copy.positive_visual_text(prompt))
        texts = data.get('cover_texts')
        validate_edited_cover_texts(texts, data['platform'], data['model'])
        style = backgrounds.normalize_style(data.get('background_style'))
        font = copy.resolve_cover_font(typography, settings)
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
        rendered = copy.render_bold_typo(background,output,texts,font,size,style,preserve_background=True,typography=typography,color_grade=color_grade) if mode=='layered_poster' else {}
        return {**result,**rendered,'prompt':prompt,'renderMode':mode,'coverTexts':texts,'backgroundStyle':style,'typography':typography,
                'colorGrade':color_grade if mode=='layered_poster' else None,
                'imageRequest':{'prompt':prompt,'model':result['model'],'size':f'{size[0]}x{size[1]}','mode':mode,'status':'completed'}}
    finally:
        background.unlink(missing_ok=True)


def typeset_image(data, settings, output):
    from . import copy, backgrounds
    if output.exists():
        raise ValueError('修改结果文件已存在，拒绝覆盖')
    texts = data.get('cover_texts')
    validate_edited_cover_texts(texts, data['platform'], data['model'])
    style = backgrounds.normalize_style(data.get('background_style'))
    typography = copy.normalize_typography(data.get('typography'))
    color_grade = copy.normalize_color_grade(data.get('color_grade'))
    font = copy.resolve_cover_font(typography, settings)
    recovered = False
    with Image.open(data['source_image']) as source:
        count=int(source.info.get('hanabi_background_parts','0'))
        if not 0<=count<=60:raise ValueError('背景图层过大')
        layer = ''.join(source.info.get(f'hanabi_background_{index}','') for index in range(count))
        if source.width*source.height>20_000_000:raise ValueError('图片像素过大')
        if layer:
            raw = base64.b64decode(layer,validate=True)
            if len(raw)>20*1024*1024:
                raise ValueError('背景图层过大')
            with Image.open(io.BytesIO(raw)) as clean:
                if clean.size != source.size:
                    raise ValueError('背景图层尺寸不符')
                image = clean.convert('RGB')
        else:
            rows = data.get('source_rows')
            if not isinstance(rows,list) or not 3 <= len(rows) <= 4:
                raise ValueError('旧图没有可用背景图层或可信排版记录，请先生成一张新图')
            image = source.convert('RGB'); recovered = True
            width,height=image.size; boxes=[]
            for row in rows:
                box=row.get('bbox',[])
                if len(box)!=4 or any(type(v) not in (float,int) for v in box):
                    raise ValueError('旧图排版记录无效')
                x1,y1,x2,y2=box;padx,pady=(24,14) if row.get('highlighted') else (2,2)
                box=(max(0,int(x1-padx)),max(0,int(y1-pady)),min(width,int(x2+padx)),min(height,int(y2+pady)))
                if box[0]>=box[2] or box[1]>=box[3]:
                    raise ValueError('旧图文字范围无效')
                boxes.append(box)
            # Clone texture from the nearest equally sized text-free horizontal band.
            # Pixels outside the recorded old glyph/highlight boxes stay unchanged.
            original=image.copy()
            for x1,y1,x2,y2 in boxes:
                h=y2-y1
                candidates=[y for y in range(0,height-h+1) if all(y+h<=b[1] or y>=b[3] for b in boxes)]
                if not candidates:
                    raise ValueError('旧图没有足够空白材质可修复，请重新生成背景')
                top=min(candidates,key=lambda y:abs(y-y1))
                image.paste(original.crop((x1,top,x2,top+h)),(x1,y1))
    background=Path(data['background_path']) if data.get('background_path') else output.with_name(output.stem+'-surface.png')
    if background.exists():raise ValueError('临时背景文件已存在，拒绝覆盖')
    try:
        image.save(background,format='PNG')
        rendered=copy.render_bold_typo(background,output,texts,font,image.size,style,preserve_background=True,typography=typography,color_grade=color_grade)
        return {**rendered,'prompt':data.get('prompt',''),'renderMode':'layered_poster','coverTexts':texts,'backgroundStyle':style,
                'colorGrade':color_grade,'backgroundRecovered':bool(data.get('background_recovered') or recovered),'model':'local-typesetter','usage':{}}
    finally:
        background.unlink(missing_ok=True)


COPY_REVISION_RETRIES = 2


def title_limit(platform):
    return 20 if platform == 'xhs' else 80


def parse_markdown_post(text=''):
    """Split saved Markdown copy into title / body / trailing tags (mirrors Hanabi parsePostText)."""
    lines = str(text or '').replace('\r\n', '\n').replace('\r', '\n').strip().split('\n')
    title = re.sub(r'^#{1,6}\s+', '', lines.pop(0) if lines else '').strip()
    tags = []
    while lines:
        line = lines[-1].strip()
        if not line:
            lines.pop()
            continue
        if not re.fullmatch(r'(?:#[^\s#]+\s*)+', line):
            break
        tags[0:0] = line.split()
        lines.pop()
    return {'title': title, 'body': '\n'.join(lines).strip(), 'tags': tags}


def format_markdown_post(title, body='', tags=None):
    title = re.sub(r'^#{1,6}\s+', '', str(title or '').strip())
    parts = [f'# {title}'.rstrip()]
    body = str(body or '').strip()
    if body:
        parts.extend(['', body])
    tag_line = ' '.join(
        tag if str(tag).startswith('#') else f'#{tag}'
        for tag in (tags or []) if str(tag).strip()
    ).strip()
    if tag_line:
        parts.extend(['', tag_line])
    return '\n'.join(parts)


def is_title_only_edit(instructions):
    """True when the user only asked to change the title; body/tags must stay byte-stable."""
    raw = str(instructions or '').strip()
    if not raw:
        return False
    # Drop short quoted title samples so「旧标题」does not look like a body edit.
    text = re.sub(r'[「『“"].{0,40}?[」』”"]', '', raw)
    # Affirmations that the body should stay are still title-only.
    text = re.sub(r'保留卖点|正文不动|别动正文|不要改正文|正文保持原样', '', text)
    body_markers = (
        '正文', '开头', '结尾', '价格', '卖点', '标签', '段落', '这段', '那句', '针对这段',
        '不要用', '别用', '删掉', '删除', '加上', '增加', '补充', '重写全文', '改写正文',
        '全文', '整篇', '适合干', '占的屏幕', '问句', '好价', '蓝橙', '撞色',
    )
    if any(marker in text for marker in body_markers):
        return False
    if '标题' not in text and not re.search(r'改标题|换标题', text):
        return False
    stripped = text
    for pattern in (
        r'请?帮我?',
        r'(?:把|将)?标题',
        r'(?:再)?改改?',
        r'换个说法|换个切口',
        r'(?:换|优化|重写|起名)',
        r'(?:一下|下)',
        r'(?:得?更?有?吸引力|更?吸睛|毫无吸引力|没有吸引力|不够吸引力|没什么吸引力)',
        r'(?:一点|一些)',
        r'\d+\s*字以内',
        r'小红书',
        r'[，。！？、,.!?;；：:\s]+',
    ):
        stripped = re.sub(pattern, '', stripped)
    return stripped == ''


def preserve_unedited_copy_parts(source_text, revised_text, instructions):
    """If the user only asked for a title change, keep source body and tags verbatim."""
    if not is_title_only_edit(instructions):
        return revised_text
    source = parse_markdown_post(source_text)
    revised = parse_markdown_post(revised_text)
    title = revised['title'] or source['title']
    return format_markdown_post(title, source['body'], source['tags'])


def validate_copy(text, platform, model):
    if not isinstance(text, str) or not text.strip() or len(text) > 18000 or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
        raise ValueError('文案须为非空文本，最多18000字，不能含控制字符')
    text = text.strip()
    title = re.sub(r'^#{1,6}\s*', '', text.splitlines()[0]).strip()
    if not title or len(title) > title_limit(platform):
        raise ValueError('标题过长：小红书最多20字，闲鱼最多80字')
    hits = words.check(text, platform, model)
    if hits:
        raise ValueError('文案包含风险词：' + '、'.join(sorted({hit['word'] for hit in hits})))
    return text


def soft_fix_title(text, platform, model):
    """Shorten an overlong Markdown title in place so AI rewrite can still publish."""
    from . import copy
    lines = str(text or '').splitlines()
    if not lines:
        return text
    match = re.match(r'^(#{1,6}\s*)(.*)$', lines[0])
    prefix, title = (match.group(1), match.group(2).strip()) if match else ('# ', lines[0].strip())
    limit = title_limit(platform)
    if not title or len(title) <= limit:
        return text
    repaired = copy.shorten_xhs_title(title, model, limit) if platform == 'xhs' else title
    if not repaired or len(repaired) > limit:
        # Last resort: cut at punctuation / space near the limit, never leave an empty title.
        cut = limit
        for index in range(min(limit, len(title)), max(7, limit // 2), -1):
            if title[index - 1] in '，。！？、；： ,.!?':
                cut = index
                break
        repaired = title[:cut].rstrip(' ，,、·-_|/：:#')
    if not repaired:
        return text
    if repaired != title:
        print(f'WARN: 改写标题超长，已自动收短为「{repaired}」。')
        lines[0] = prefix + repaired
    return '\n'.join(lines)


def is_copy_revision_retryable(error):
    reason = str(error)
    return any(marker in reason for marker in ('标题过长', '风险词', '未返回完整文案', '改写文案被截断'))


def revise_copy(data, settings):
    if data['action'] == 'manual':
        return {'text': validate_copy(data.get('text'), data['platform'], data['model'])}
    from .preferences import load_preferences
    preference, _, _, _, _ = load_preferences(ROOT/'data/distilled-preferences.json', data['platform'], 26000)
    limit = title_limit(data['platform'])
    prompt = ('修改下方这一篇文案，保留未要求修改的事实、型号、价格和信息。'
              '只允许使用原文、当前简报、已核验事实和用户本次明确提供的资料，不新增实测、库存或效果承诺。'
              '遵守当前内容规范和风险词，不照搬参考帖事实。'
              '未在 instructions 点名修改的句子、卖点条目、价格段、结尾和标签禁止改写、调序或同义替换。'
              '若 instructions 只要求改标题/换标题/标题更有吸引力等，则正文与末尾标签必须与 source_text 逐字相同，只改第一行标题。'
              f'标题第一行必须完整可读且不超过{limit}字（小红书20、闲鱼80）；宁可换短切口，也不截断半个词。'
              '只返回JSON对象，text字段是完整Markdown文案，第一行是标题，随后是正文和标签。修改只影响当前文案版本。\n'
              + preference)
    user_payload = {key: data.get(key) for key in ('platform', 'model', 'source_text', 'brief', 'facts', 'instructions')}
    last_error, last_usage = None, {}
    for attempt in range(COPY_REVISION_RETRIES + 1):
        messages = [
            {'role': 'system', 'content': prompt},
            {'role': 'user', 'content': json.dumps(user_payload, ensure_ascii=False)},
        ]
        if attempt > 0:
            messages.append({'role': 'user', 'content': json.dumps({
                'retry': True,
                'attempt': attempt,
                'previous_error': str(last_error),
                'title_limit': limit,
                'instruction': (
                    f'上一稿校验失败：{last_error}。请整篇重写当前文案；'
                    f'标题必须≤{limit}字且意思完整，避开风险词；'
                    '不要沿用超长标题；只返回JSON对象{"text":"完整Markdown文案"}。'
                ),
            }, ensure_ascii=False)})
        try:
            response = gateway.request_json(settings['CONTENT_OPS_BASE_URL'].rstrip('/') + '/chat/completions', {
                'model': settings['CONTENT_OPS_TEXT_MODEL'], 'messages': messages,
                'max_tokens': 8000, 'temperature': 0.4, 'response_format': {'type': 'json_object'}
            }, settings['CONTENT_OPS_API_KEY'], 180)
        except gateway.ImageGenerationError as error:
            raise ValueError(f'改写请求失败：{error}；原稿已保留') from None
        choice = response.get('choices', [{}])[0]
        last_usage = response.get('usage', {})
        if choice.get('finish_reason') == 'length':
            last_error = ValueError('改写文案被截断，原稿已保留；可缩短修改要求后重试')
            if attempt >= COPY_REVISION_RETRIES:
                raise last_error
            print(f'WARN: AI改写被截断，正在重出第 {attempt + 1}/{COPY_REVISION_RETRIES} 次…')
            continue
        raw = choice.get('message', {}).get('content', '').strip()
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw)
        try:
            text = json.loads(raw)['text']
        except (ValueError, KeyError, TypeError):
            last_error = ValueError('改写模型未返回完整文案，原稿已保留')
            if attempt >= COPY_REVISION_RETRIES:
                raise last_error from None
            print(f'WARN: AI改写返回无法解析，正在重出第 {attempt + 1}/{COPY_REVISION_RETRIES} 次…')
            continue
        text = soft_fix_title(text, data['platform'], data['model'])
        text = preserve_unedited_copy_parts(data.get('source_text', ''), text, data.get('instructions', ''))
        try:
            return {'text': validate_copy(text, data['platform'], data['model']),
                    'model': settings['CONTENT_OPS_TEXT_MODEL'], 'usage': last_usage,
                    'attempts': attempt + 1}
        except ValueError as error:
            last_error = error
            if not is_copy_revision_retryable(error) or attempt >= COPY_REVISION_RETRIES:
                raise
            print(f'WARN: AI改写校验失败（{error}），正在重出第 {attempt + 1}/{COPY_REVISION_RETRIES} 次…')
    raise last_error


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
    if data['kind']=='image' and data['action']=='typeset' and image_output:
        return typeset_image(data,settings,image_output)
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
