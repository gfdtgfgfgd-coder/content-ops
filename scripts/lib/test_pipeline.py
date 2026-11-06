"""Offline regressions. Run: PYTHONPATH=scripts scratch/.venv/bin/python3 -m unittest lib.test_pipeline -v"""
from argparse import Namespace
from contextlib import redirect_stdout, redirect_stderr
from copy import deepcopy
import importlib.util
import io
import json
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from . import cleaning, copy, fetching, gateway, preferences, store, words

ROOT = Path(__file__).resolve().parents[2]


def structured_post(fmt='format_1', n=1):
    content = {
        'intro':'开发需求变多，先把步骤理清。',
        'selling_points':'**把目标限制和验收写清楚**\n\n**长任务拆成小步逐项核对**',
        'price':'能力升级，复杂任务少绕路\n开销降低，便宜量大更省心',
        'compatibility':'兼容CC的情况待确认，先核对工具。',
        'scenarios':'需求整理、代码修改都先明确验收。',
        'audience':'独立开发者和小团队可按任务安排。',
        'hook':f'第{n}种切入，带上你要做的小任务\n先确认需求，再看看怎样推进。',
    }
    return {'title':f'开发任务这样拆{n}', 'title_lines':['需求一眼看清','GLM5.3','开发流程拆得更顺'],
            'copy_format':fmt, 'sections':[{'kind':kind,'text':content[kind]} for kind in copy.COPY_FORMATS[fmt]],
            'tags':['#GLM5.3','#开发流程','#需求整理'], 'angle':f'切入角度{n}', 'audience':'独立开发者',
            'cover_subtitle':'目标限制验收一次讲清', 'cover_highlight':'适合独立开发者'}


class PipelineTests(unittest.TestCase):
    def test_edited_xianyu_recalculates_missing_signal(self):
        posts = [{'id': 'clean', 'platform': 'xianyu', 'title': '正常标题', 'metrics': {'wants': 8}},
                 {'id': 'banned', 'platform': 'xianyu', 'body': '命中风险', 'metrics': {'wants': 3}}]
        with patch.object(preferences, 'read_posts', return_value=posts), patch.object(
                preferences, 'clean_reference_hits', side_effect=[[], ['风险']]) as check:
            refs = preferences.xianyu_references(self.base, [], 'xianyu', 10)
        self.assertEqual([row['clean_for_style_reference'] for row in refs], [True, False])
        self.assertEqual(refs[1]['banned_word_hits'], ['风险'])
        self.assertEqual(check.call_count, 2)


    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)

    def test_counts_and_unique_ids(self):
        source = self.base / 'posts.jsonl'
        store.write_posts([{'id': 'a', 'platform': 'xhs'}, {'id': 'b', 'platform': 'xhs'},
                           {'id': 'c', 'platform': 'xianyu'}], source)
        with patch.object(store, 'POSTS', source):
            self.assertEqual(store.post_count(), 3)
            self.assertEqual(len(store.load_posts('xhs')), 2)
            self.assertEqual(len(store.load_posts('xianyu')), 1)
            self.assertEqual(len({p['id'] for p in store.load_posts()}), 3)

    def test_store_roundtrip_and_order(self):
        path = self.base / 'posts.jsonl'
        rows = [{'id': 'b', 'platform': 'z', 'body': '中文\n换行'}, {'id': 'a', 'platform': 'x'}]
        store.write_posts(rows, path)
        self.assertEqual(store.read_posts(path), rows[::-1])
        self.assertTrue(path.read_bytes().endswith(b'\n'))
        self.assertIn('中文', path.read_text())

    def test_duplicate_rejected_without_overwriting(self):
        path = self.base / 'posts.jsonl'
        path.write_text('existing')
        with self.assertRaises(ValueError):
            store.write_posts([{'id': 'a', 'platform': 'x'}] * 2, path)
        self.assertEqual(path.read_text(), 'existing')

    def test_migration_differences_keep_all_legacy(self):
        data = self.base / 'data/sample'
        data.mkdir(parents=True)
        row = {'id': 'ab', 'platform': 'sample', 'title': '标题', 'metrics': {'likes': 1},
               'is_pinned': False, 'image_urls': ['https://old/cover'], 'url': 'https://example/explore/ab?xsec_token=key', 'type': 'normal'}
        (data / 'ab.json').write_text(json.dumps(row))
        index = {'id': 'ab', 'title': '不同标题', 'likes': '1', 'sticky': False,
                 'cover': 'https://old/cover', 'xsec': 'key', 'type': 'normal'}
        (data / '_index.json').write_text(json.dumps([index]))
        (data / '_urls.txt').write_text(row['url'] + '\n')
        config = {'profiles': {'sample': {}}, 'posts_file': 'data/posts.jsonl',
                  'migration_expected_counts': {'sample': 1},
                  'migration_indexes': [{'platform': 'sample', 'index': 'data/sample/_index.json', 'urls': 'data/sample/_urls.txt'}]}
        (self.base / 'config.json').write_text(json.dumps(config))
        args = ['--root', str(self.base), '--config', 'config.json', '--report', str(self.base / 'report.json'), '--delete-legacy']
        with redirect_stdout(io.StringIO()):
            self.assertEqual(store.migrate(args), 1)
        self.assertTrue((data / 'ab.json').exists())
        self.assertEqual(json.loads((self.base / 'report.json').read_text())['differences'][0]['field'], 'title')
        # Only an exact full comparison allows the deletion path.
        index['title'] = row['title']
        (data / '_index.json').write_text(json.dumps([index]))
        with redirect_stdout(io.StringIO()):
            self.assertEqual(store.migrate(args), 0)
        self.assertFalse(data.exists())
        self.assertEqual(store.read_posts(self.base / 'data/posts.jsonl'), [row])

    def test_clean_all_separate_output_is_idempotent(self):
        source = self.base / 'input.jsonl'
        posts = store.load_posts()
        store.write_posts(posts, source)
        target = self.base / 'output.jsonl'
        args = ['--platform', 'all', '--input-dir', str(source), '--output-dir', str(target)]
        with redirect_stdout(io.StringIO()):
            cleaning.clean(args)
        first = target.read_bytes()
        with redirect_stdout(io.StringIO()):
            cleaning.clean(['--platform', 'all', '--input-dir', str(target)])
        self.assertEqual(target.read_bytes(), first)
        self.assertEqual(len(store.read_posts(target)), len(posts))
        self.assertEqual(len(store.read_posts(source)), len(posts))

    def test_clean_dry_run_does_not_write(self):
        source = self.base / 'input.jsonl'
        store.write_posts(store.load_posts(), source)
        before = source.read_bytes()
        with redirect_stdout(io.StringIO()):
            cleaning.clean(['--platform', 'all', '--input-dir', str(source), '--dry-run'])
        self.assertEqual(source.read_bytes(), before)

    def test_word_output_semantics(self):
        hits = words.check('最便宜 5 折', 'xhs')
        self.assertEqual([hit['word'] for hit in hits], ['最便宜', '5 折'])
        self.assertTrue(words.check('API', 'xianyu'))
        self.assertFalse(words.check('安排一次任务', 'xhs'))

    def test_xhs_references_filters_deleted_and_unmarked_posts(self):
        source = self.base / 'posts.jsonl'
        posts = [{'id': 'a', 'platform': 'xhs', 'label': {'good': True}, 'body': '普通内容'},
                 {'id': 'b', 'platform': 'xhs', 'label': {'good': False}},
                 {'id': 'c', 'platform': 'xhs', 'label': {'good': True}}]
        store.write_posts(posts, source)
        refs = {'xhs_good_posts': [{'id': value} for value in ['a', 'b', 'deleted']]}
        log = io.StringIO()
        with redirect_stderr(log):
            selected = preferences.xhs_references(source, refs, [], 'xhs', 29)
        self.assertEqual([post['id'] for post in selected], ['a'])
        self.assertTrue(selected[0]['clean_for_style_reference'])
        self.assertIn('已删除或取消精选 2 条', log.getvalue())
        store.write_posts(posts[1:], source)
        with redirect_stderr(io.StringIO()):
            self.assertEqual(preferences.xhs_references(source, refs, [], 'xhs', 29), [])

    def test_preference_build_accepts_an_empty_temporary_reference_dataset(self):
        config_path = ROOT / 'config/preference-build.json'
        config = json.loads(config_path.read_text())
        for relative in set(config['paths'].values()) | {'config/preference-build.json'}:
            target = self.base / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        store.write_posts([], self.base / config['paths']['xhs_data_dir'])
        with redirect_stderr(io.StringIO()):
            bundle = preferences.build_bundle(self.base, self.base / 'config/preference-build.json', '2026-11-05')
        self.assertEqual(bundle['style_references']['xhs_good_posts'], [])
        self.assertEqual(bundle['style_references']['xianyu_top_posts'], [])

    def test_preferences_loader_and_fallback(self):
        with redirect_stdout(io.StringIO()):
            block, version, snapshots, palettes, rules = preferences.load_preferences(ROOT / 'data/distilled-preferences.json', 'xhs', 40000)
            xianyu = preferences.load_preferences(ROOT / 'data/distilled-preferences.json', 'xianyu', 40000)
            self.assertIn('xianyu',xianyu[0])
            fallback = preferences.load_preferences(self.base / 'missing.json', 'xhs', 40000)
        self.assertIn('运营偏好', block)
        self.assertEqual(version['source'], 'distilled-preferences.json')
        self.assertEqual(fallback[1]['source'], 'fallback')
        self.assertTrue(palettes and rules and snapshots)
        bundle = preferences.build_bundle(ROOT, ROOT / 'config/preference-build.json', '2026-11-04')
        self.assertIn('小红书与闲鱼', bundle['known_conflicts']['api_policy']['decision'])
        self.assertIn('API', bundle['known_conflicts']['api_policy']['decision'])
        with self.assertRaises(ValueError), redirect_stdout(io.StringIO()):
            preferences.load_preferences(ROOT / 'data/distilled-preferences.json', 'xhs', 1)

    def test_reference_selection_hashes_and_missing(self):
        post = store.load_posts('xhs')[0]
        selected = self.base / 'references.json'
        selected.write_text(json.dumps([{'platform': 'xhs', 'id': post['id']}]))
        references, contexts, hashes = copy.load_references(selected)
        self.assertEqual(references[0]['id'], post['id'])
        self.assertEqual(contexts[0]['body'], post['body'])
        self.assertEqual(len(next(iter(hashes.values()))), 64)
        selected.write_text('[{"platform":"xhs","id":"does-not-exist"}]')
        with self.assertRaises(ValueError):
            copy.load_references(selected)

    def test_ingest_checkpoint_without_images(self):
        source = self.base / 'incoming.json'
        output = self.base / 'posts.jsonl'
        source.write_text(json.dumps([{'url': 'https://example/explore/abc', 'title': '中文', 'metrics': {'likes': '1.2万'}}]))
        args = ['--platform', 'xhs', '--records', str(source), '--output', str(output), '--skip-existing']
        with redirect_stdout(io.StringIO()):
            self.assertEqual(fetching.posts_main(args), 0)
        before = output.read_bytes()
        with redirect_stdout(io.StringIO()):
            self.assertEqual(fetching.posts_main(args), 0)
        self.assertEqual(output.read_bytes(), before)
        self.assertEqual(store.read_posts(output)[0]['metrics']['likes'], 12000)

    def test_image_cli_mocked_no_network(self):
        image = self.base / 'image.png'
        info = {'output': str(image)}
        with patch.object(gateway, 'generate_image', return_value=info) as generate, redirect_stdout(io.StringIO()):
            self.assertEqual(gateway.main(['--prompt', '测试', '--output', str(image), '--config', str(self.base / 'missing.env')]), 0)
        generate.assert_called_once()

    def test_copy_pipeline_offline_and_resume(self):
        background = self.base / 'background.png'
        Image.new('RGB', (64, 64), '#eeeeee').save(background)
        refs = self.base / 'references.json'
        refs.write_text(json.dumps([{'platform': 'xhs', 'id': store.load_posts('xhs')[0]['id']}]))
        settings = {'CONTENT_OPS_API_KEY': 'offline-test-only', 'CONTENT_OPS_BASE_URL': 'https://offline.invalid/v1',
                    'CONTENT_OPS_TEXT_MODEL': 'claude-offline-test', 'CONTENT_OPS_IMAGE_MODEL': 'offline'}
        body = ('把需求拆成输入、限制和验收三部分，再给出一个需要完成的小任务。保留每一步的结果，逐项核对任务是否做到。'
                '不确定的地方先列出来，补齐背景再继续。把改动与原稿放在一起检查，确认文字表达清楚、细节完整后再整理成稿。')
        post = {'title_lines': ['安排一次任务', 'GLM5.3', '拆开需求逐项检查'], 'body': body,
                'tags': ['#GLM5.3', '#任务拆解', '#需求整理'], 'angle': '任务清单', 'audience': '程序员、独立开发者',
                'image_prompt': '深色数字工作台，蓝色玻璃面板，清晰中文大标题，电影级柔和体积光'}
        post.update(structured_post())
        with patch.object(gateway, 'load_config', return_value=settings), \
             patch.object(gateway, 'request_json', side_effect=AssertionError('network forbidden')), \
             patch.object(copy, 'claude_call', return_value=({'posts': [post]}, {})) as calls, \
             patch.object(gateway, 'generate_image', side_effect=AssertionError('paid image forbidden')), \
             redirect_stdout(io.StringIO()):
            args = ['--model', 'GLM5.3', '--count', '1', '--copy-multiplier', '1', '--output', str(self.base / 'batch'),
                    '--background', str(background), '--references', str(refs), '--brief', '开发者任务工具，便宜量大']
            self.assertEqual(copy.main(args), 0)
            self.assertEqual(calls.call_count, 1)
            payload = json.loads(calls.call_args.args[1])
            self.assertEqual(payload['brief'], '开发者任务工具，便宜量大')
            self.assertEqual(len(payload['few_shot_examples']), 1)
            count = calls.call_count
            self.assertEqual(copy.main([*args, '--resume']), 0)
            self.assertEqual(calls.call_count, count)
            changed = [*args]
            changed[-1] = '不同的需求'
            self.assertEqual(copy.main([*changed, '--resume']), 1)
            self.assertEqual(calls.call_count, count)
        manifest = json.loads((self.base / 'batch/manifest.json').read_text())
        self.assertEqual(manifest['status'], 'completed')
        self.assertEqual(manifest['references'][0]['platform'], 'xhs')
        self.assertEqual(manifest['posts'][0]['image_metadata']['mode'], 'offline_background_composition')
        self.assertEqual((manifest['posts'][0]['image_metadata']['width'], manifest['posts'][0]['image_metadata']['height']), (1080, 1440))
        self.assertTrue((self.base / 'batch/post-1.png').exists())

    def test_automatic_references_same_platform_and_manual_override(self):
        rows = [
            {'platform': 'xhs', 'id': 'good', 'title': '推荐', 'body': '分段示例', 'label': {'good': True}, 'metrics': {'likes': 1}},
            {'platform': 'xhs', 'id': 'popular', 'title': '热门', 'body': '分段示例', 'metrics': {'likes': 999}},
            {'platform': 'xhs', 'id': 'normal', 'title': '普通', 'metrics': {'likes': 10}},
            {'platform': 'xhs', 'id': 'low', 'title': '低互动', 'metrics': {'likes': 0}},
            {'platform': 'xianyu', 'id': 'wanted', 'title': '想要', 'metrics': {'wants': 9999}}]
        def source(platform=None):
            return [r for r in rows if platform is None or r['platform'] == platform]
        with patch.object(copy, 'load_posts', side_effect=source):
            refs, contexts, hashes = copy.load_references(None)
            self.assertEqual([r['id'] for r in refs], ['good', 'popular', 'normal'])
            self.assertEqual(len(hashes), 3)
            self.assertTrue(all(r['platform'] == 'xhs' for r in contexts))
            self.assertEqual(copy.load_references(None, platform='xianyu')[0][0]['id'], 'wanted')
            path = self.base / 'manual.json'
            path.write_text(json.dumps([{'id': 'low', 'platform': 'xhs'}]))
            self.assertEqual(copy.load_references(path)[0][0]['id'], 'low')
            path.write_text('[]')
            self.assertEqual(len(copy.load_references(path)[0]), 3)
            with self.assertRaises(ValueError):
                copy.load_references(None, max_chars=1)
        refs, contexts, _ = copy.load_references(None, platform='xhs', model='Kimi K3.1 Pro')
        self.assertEqual(len(refs), 3)
        self.assertTrue(all(r['platform'] == 'xhs' and r['title'] for r in refs))

    def test_relaxed_voice_title_dynamic_audience_and_cover_risk(self):
        post = {'title_lines': ['程序员还在为上下文发愁？', 'Kimi K3.1 Pro', '编程与长程任务'],
                'body': '我整理需求时会把背景和限制一起写清。' * 7 + '亲测、实测和用下来的经验可以自然表达。',
                'tags': ['#KimiK3.1Pro', '#程序员', '#独立开发者'], 'audience': '程序员、独立开发者',
                'angle': '痛点切入', 'cover_subtitle': '编程与长程任务', 'cover_highlight': '开发者需求',
                'image_prompt': '科技工作台与中文商业排版'}
        self.assertEqual(copy.validate_posts({'posts': [post]}, 1, 'Kimi K3.1 Pro')[0]['audience'], '程序员、独立开发者')
        for field in ['body', 'cover_subtitle', 'cover_highlight', 'audience']:
            invalid = {**post, field: 'API' + post[field]}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, '风险词'):
                copy.validate_posts({'posts': [invalid]}, 1, 'Kimi K3.1 Pro')

    def test_markdown_keeps_audience_out_of_public_body(self):
        post = {'title_lines': ['标题一', 'GLM5.3', '标题三'],
                'body': '短句正文。\n\n再一段。  \n',
                'tags': ['#GLM53', '#创作'], 'audience': '独立开发者'}
        rendered = copy.markdown(post)
        self.assertIn('短句正文。\n\n再一段。', rendered)
        self.assertNotIn('适合人群', rendered)
        self.assertNotIn('独立开发者', rendered)

    def test_mobile_reflow_preserves_text_and_paragraphs(self):
        original = '试着整理 GLM5.3 的任务输入，先把约束、输出要求和测试步骤讲清楚。\n\n做独立开发、搭 Agent 流水线的朋友，可以按自己的项目试试。'
        rendered = copy.mobile_body(original)
        self.assertTrue(all(len(line) <= 30 for line in rendered.splitlines()))
        self.assertEqual(''.join(original.split()), ''.join(rendered.split()))
        self.assertIn('GLM5.3', rendered)
        phrase = copy.mobile_body('这套流程适合独立开发者和搭 Agent 工作流的人，平时可以直接套用到自己的项目里。')
        self.assertIn('搭 Agent 工作流的人', phrase)
        self.assertNotIn('Agent\n工作流', phrase)
        self.assertIn('\n\n', rendered)
        self.assertEqual(copy.mobile_body(rendered), rendered)
        self.assertEqual(copy.mobile_body('正文。\n\n适合人群：开发者'), '正文。')
        with self.assertRaisesRegex(ValueError, '连续标题冒号'):
            copy.mobile_body('▫️编程辅助：长句说明\n\n▫️需求整理：长句说明\n\n▫️项目协作：长句说明')
        selling_points = '\n'.join([
            '💻 **重构老鸟**：解析工程目录，跨模块调用不串台。',
            '🛠️ **漏洞自修**：主动排查缺陷，直接给出修复补丁。',
            '📋 **任务拆解**：模糊需求摊平，自动生成开发清单。',
        ])
        self.assertIn('重构老鸟', copy.mobile_body(selling_points, maximum=20, allow_heading_runs=True))

    def test_platform_poster_sizes_and_prompt(self):
        self.assertEqual(copy.poster_size('xhs'), (1080, 1440))
        self.assertEqual(copy.poster_size('xianyu'), (1080, 1080))
        post = {'image_prompt': '立体科技工作台，琥珀色与冷蓝色对比',
                'title_lines': ['效率提升', 'GLM5.3', '需求拆解'],
                'cover_subtitle': '完整工作流', 'cover_highlight': '适合独立开发者'}
        xhs_prompt = copy.direct_image_prompt(post, 'xhs')
        self.assertIn('竖版3:4，1080×1440px', xhs_prompt)
        self.assertIn('遵循视觉提示词中的构图', xhs_prompt)
        self.assertIn('不留大面积空白', xhs_prompt)
        conflicting = {**post, 'image_prompt': '1:1 方图，1080x1080px，正方形画布中的科技工作台'}
        normalized = copy.direct_image_prompt(conflicting, 'xhs')
        self.assertIn('竖版3:4', normalized)
        self.assertIn('1080×1440px', normalized)
        self.assertNotIn('1:1', normalized)
        self.assertNotIn('1080x1080', normalized)
        self.assertNotIn('正方形画布', normalized)
        self.assertNotIn('构图构图', normalized)
        self.assertIn('目标画幅中的科技工作台', normalized)
        xianyu = copy.direct_image_prompt(conflicting, 'xianyu')
        self.assertIn('方图1:1', xianyu)
        self.assertIn('1080×1080px', xianyu)
        self.assertNotIn('3:4', xianyu)
        self.assertIn('方图1:1，1080×1080px', copy.direct_image_prompt(post, 'xianyu'))

    def test_fresh_generation_sends_final_poster_prompt_and_size(self):
        settings = {'CONTENT_OPS_API_KEY': 'offline-test-only', 'CONTENT_OPS_BASE_URL': 'https://offline.invalid/v1',
                    'CONTENT_OPS_TEXT_MODEL': 'glm-5.3', 'CONTENT_OPS_IMAGE_MODEL': 'qwen-image-3.0'}
        body = '整理开发需求时，把目标、限制和验收写在一起。先拆清楚要完成的事情，再逐步检查结果。' * 3
        post = {'title_lines': ['需求一眼看清', 'GLM5.3', '开发流程拆得更顺'], 'body': body,
                'tags': ['#GLM5.3', '#开发流程', '#需求整理'], 'angle': '场景拆解', 'audience': '独立开发者',
                'cover_subtitle': '目标限制验收一次讲清', 'cover_highlight': '适合独立开发者',
                'image_prompt': '文案模型不得提供视觉提示词'}
        post.update(structured_post())
        visual_prompt = '参考图采用深色代码工作台、冷蓝屏光与琥珀轮廓光；主标题置于上部，玻璃材质信息牌居中。'
        def image_call(*, prompt, output, size, **kwargs):
            Image.new('RGB', (1080, 1440), '#152638').save(output)
            data = output.read_bytes()
            return {'output': str(output), 'model': kwargs['model'], 'requested_size': size,
                    'width': 1080, 'height': 1440, 'bytes': len(data), 'sha256': __import__('hashlib').sha256(data).hexdigest()}
        with patch.object(gateway, 'load_config', return_value=settings), \
             patch.object(copy, 'claude_call', return_value=({'posts': [post, structured_post('format_2',2), structured_post('format_3',3)]}, {})), \
             patch.object(copy, 'visual_prompt_call', return_value=(visual_prompt, {'model':'vision-test','usage':{'prompt_tokens':12}})) as vision, \
             patch.object(gateway, 'generate_image', side_effect=image_call) as generate, \
             redirect_stdout(io.StringIO()):
            result = copy.run(Namespace(model='GLM5.3', brief='', preferences=copy.ROOT/'data/distilled-preferences.json',
                platform='xhs', count=1, preference_max_chars=32000, config=self.base/'gateway.env', facts=None,
                output=self.base/'direct', resume=False, references=None, reference_max_chars=32000,
                timeout=120, background=None))
        self.assertEqual(generate.call_args.kwargs['size'], '1080x1440')
        self.assertIn('竖版3:4，1080×1440px', generate.call_args.kwargs['prompt'])
        self.assertIn('参考图采用深色代码工作台', generate.call_args.kwargs['prompt'])
        self.assertNotIn(post['image_prompt'], generate.call_args.kwargs['prompt'])
        self.assertEqual(vision.call_args.args[0]['title_lines'], post['title_lines'])
        self.assertTrue(vision.call_args.args[1])
        self.assertEqual(result['posts'][0]['image_metadata']['mode'], 'direct_poster')
        self.assertEqual((result['posts'][0]['image_metadata']['width'], result['posts'][0]['image_metadata']['height']), (1080, 1440))
        manifest = json.loads((self.base/'direct/manifest.json').read_text())
        self.assertEqual(manifest['vision_calls'][0]['model'], 'vision-test')
        self.assertEqual(manifest['posts'][0]['visual_prompt'], visual_prompt)

        generate.assert_called_once()
        vision.assert_called_once()
        self.assertEqual(manifest['count'], 1)
        self.assertEqual(manifest['copy_count'], 3)
        versions = manifest['posts'][0]['copies']
        self.assertEqual([v['copy_format'] for v in versions], ['format_1','format_2','format_3'])
        self.assertEqual([v['markdown'] for v in versions], [f'post-1-copy-{i}.md' for i in range(1,4)])
        saved = [(self.base/'direct'/v['markdown']).read_text() for v in versions]
        self.assertEqual(len(set(saved)),3)
        self.assertEqual(len(list((self.base/'direct').glob('post-*.png'))),1)

    def test_vision_sends_real_images_and_platform_context(self):
        import base64
        image_dir = self.base / 'data/images/xhs/example'
        image_dir.mkdir(parents=True)
        references = []
        for i, extension in enumerate(['jpg', 'webp', 'png', 'jpg']):
            image = image_dir / f'{i}.{extension}'
            Image.new('RGB', (8, 8), '#223344').save(image)
            references.append({'image_paths': [str(image.relative_to(self.base))]})
        post = {'title_lines':['标题','GLM5.3','卖点'], 'cover_subtitle':'长任务',
                'cover_highlight':'开发人群', 'body':'本次核心卖点。', 'audience':'开发者'}
        response = {'model':'vision-selected','usage':{'prompt_tokens':123},
                    'choices':[{'finish_reason':'stop','message':{'content':'冷暖对比与清晰大字的原创海报'}}]}
        settings = {'CONTENT_OPS_BASE_URL':'https://offline.invalid/v1', 'CONTENT_OPS_API_KEY':'test',
                    'CONTENT_OPS_VISION_MODEL':'vision-selected'}
        with patch.object(copy, 'ROOT', self.base), patch.object(gateway, 'request_json', return_value=response) as request:
            prompt, log = copy.visual_prompt_call(post, references, settings, 1, self.base/'visual.txt', 'xianyu')
            payload = request.call_args.args[1]
            self.assertEqual(payload['model'], 'vision-selected')
            self.assertEqual(payload['max_tokens'], 2400)
            content = payload['messages'][0]['content']
            self.assertEqual(len(content), 4)
            self.assertIn('方图1:1', content[0]['text'])
            self.assertNotIn('3:4', content[0]['text'])
            self.assertIn('本次核心卖点', content[0]['text'])
            for i, part in enumerate(content[1:]):
                encoded = part['image_url']['url']
                self.assertEqual(base64.b64decode(encoded.split(',')[1]), (image_dir/f"{i}.{['jpg','webp','png'][i]}").read_bytes())
            self.assertEqual(log['reference_images'], 3)
            self.assertEqual(log['usage']['prompt_tokens'], 123)
            self.assertTrue(all(len(x['sha256']) == 64 for x in log['sources']))
            self.assertEqual((self.base/'visual.txt').read_text(), prompt)
        with patch.object(copy, 'ROOT', self.base), patch.object(gateway, 'request_json') as request:
            with self.assertRaisesRegex(ValueError, '没有可读取'):
                copy.visual_prompt_call(post, [{'image_paths':['../../secret.jpg']}], settings, 1, self.base/'absent.txt', 'xhs')
            request.assert_not_called()
        with patch.object(copy, 'ROOT', self.base), patch.object(gateway, 'request_json', return_value={**response,'choices':[{'finish_reason':'length','message':{'content':'截断提示词'}}]}):
            with self.assertRaisesRegex(ValueError, '被截断'):
                copy.visual_prompt_call(post, references, settings, 1, self.base/'truncated.txt', 'xhs')
            self.assertEqual((self.base/'truncated.txt').read_text(),'截断提示词')
        for error, expected in [
            (gateway.ImageGenerationError('Gateway connection failed: timed out'), '网络超时'),
            (gateway.ImageGenerationError('Gateway HTTP 400: image input is not supported'), '不支持图像输入'),
        ]:
            with patch.object(copy, 'ROOT', self.base), patch.object(gateway, 'request_json', side_effect=error):
                with self.subTest(error=error), self.assertRaisesRegex(ValueError, expected):
                    copy.visual_prompt_call(post, references, settings, 1, self.base/'failed.txt', 'xhs')
        with patch.object(copy, 'ROOT', self.base), patch.object(gateway, 'request_json', return_value={'choices':[{'finish_reason':'stop','message':{'content':''}}]}):
            with self.assertRaisesRegex(ValueError, '可能不支持图像输入'):
                copy.visual_prompt_call(post, references, settings, 1, self.base/'empty.txt', 'xhs')
        with patch.object(copy, 'ROOT', self.base), patch.object(gateway, 'request_json', return_value={'choices':[]}):
            with self.assertRaisesRegex(ValueError, '可能不支持图像输入'):
                copy.visual_prompt_call(post, references, settings, 1, self.base/'no-choice.txt', 'xhs')

    def test_saved_gateway_fields_override_inherited_environment(self):
        config = self.base / 'gateway.env'
        config.write_text('CONTENT_OPS_API_KEY="file-test-key"\nCONTENT_OPS_TEXT_MODEL=selected-model\nOTHER=file\n')
        with patch.dict(gateway.os.environ, {'CONTENT_OPS_API_KEY': 'inherited-test-key', 'CONTENT_OPS_TEXT_MODEL': 'old-model', 'OTHER': 'environment'}, clear=True):
            settings = gateway.load_config(config)
        self.assertEqual(settings['CONTENT_OPS_API_KEY'], 'file-test-key')
        self.assertEqual(settings['CONTENT_OPS_TEXT_MODEL'], 'selected-model')
        self.assertEqual(settings['OTHER'], 'environment')

    def test_selected_text_model_reaches_upstream(self):
        settings = {'CONTENT_OPS_TEXT_MODEL': 'selected-model', 'CONTENT_OPS_BASE_URL': 'https://offline.invalid/v1', 'CONTENT_OPS_API_KEY': 'test-key'}
        response = {'choices': [{'message': {'content': '{"posts": []}'}, 'finish_reason': 'stop'}]}
        with patch.object(gateway, 'request_json', return_value=response) as request:
            copy.claude_call('system', 'user', settings, 1, self.base / 'response.txt')
        self.assertEqual(request.call_args.args[1]['model'], 'selected-model')

    def test_brief_validation_and_resume_input_identity(self):
        for brief in ['长' * 1001, 'bad\x00brief']:
            with patch.object(copy, 'claude_call') as calls, redirect_stdout(io.StringIO()):
                self.assertEqual(copy.main(['--model', 'GLM5.3', '--brief', brief]), 1)
                calls.assert_not_called()

    def test_cover_style_auto_and_manual(self):
        self.assertEqual(copy.validate_style('auto', 'code_ide', 'ignored'), ('auto', '', ''))
        self.assertEqual(copy.validate_style('manual', 'code_ide', ' 蓝紫霓虹光 '), ('manual', 'code_ide', '蓝紫霓虹光'))
        with self.assertRaisesRegex(ValueError, '至少选择一种预设风格或填写自定义画面感觉'):
            copy.validate_style('manual', '', '   ')
        with self.assertRaisesRegex(ValueError, '预设封面风格无效'):
            copy.validate_style('manual', 'bad_preset', '')
        with self.assertRaisesRegex(ValueError, '风险词'):
            copy.validate_style('manual', '', '包含 API 禁词', platform='xhs', model='GLM5.3')
        instruction = copy.build_style_instruction('manual', 'code_ide', '暗黑极客风、蓝紫霓虹光')
        self.assertIn('预设流派【极客代码屏】', instruction)
        self.assertIn('自定义画面感觉要求：暗黑极客风、蓝紫霓虹光', instruction)
        post = {'image_prompt': '工作台海报', 'title_lines': ['效率提升', 'GLM5.3', '需求拆解'],
                'cover_subtitle': '完整工作流', 'cover_highlight': '适合独立开发者'}
        direct = copy.direct_image_prompt(post, 'xhs', '视觉提示词', style_mode='manual', style_preset='code_ide', style_prompt='蓝紫霓虹光')
        self.assertIn('风格与画面感觉要求：预设流派【极客代码屏】', direct)
        self.assertIn('蓝紫霓虹光', direct)

    def test_copy_options_config_precedence_and_invalid_inputs(self):
        self.assertEqual(copy.copy_options(), ('all_variations',3))
        settings = {'CONTENT_OPS_COPY_FORMAT':'format_3','CONTENT_OPS_COPY_MULTIPLIER':'5'}
        self.assertEqual(copy.copy_options(settings=settings), ('format_3',5))
        self.assertEqual(copy.copy_options('format_1',1,settings), ('format_1',1))
        for multiplier in [0,6,1.5,True,{},'03','3.0']:
            with self.subTest(multiplier=multiplier), self.assertRaises(ValueError):
                copy.copy_options('all_variations',multiplier)
        for fmt in ['', 'bad', 2, []]:
            with self.subTest(fmt=fmt), self.assertRaises(ValueError):
                copy.copy_options(fmt,3)
        for argv in [['--copy-multiplier','0'], ['--copy-multiplier','6']]:
            with patch.object(copy,'claude_call') as calls, redirect_stdout(io.StringIO()):
                self.assertEqual(copy.main(['--model','GLM5.3',*argv]),1)
                calls.assert_not_called()

    def test_copy_structure_validation_and_risk_checks_cover_every_version(self):
        posts = [structured_post(copy.format_for('all_variations',i),i+1) for i in range(5)]
        result = copy.validate_posts({'posts':deepcopy(posts)},5,'GLM5.3',copy_format='all_variations')
        self.assertEqual([p['copy_format'] for p in result], ['format_1','format_2','format_3','format_1','format_2'])
        for index in range(5):
            for field in ['title','tags','sections']:
                bad = deepcopy(posts)
                if field == 'sections': bad[index][field][-1]['text'] += ' API'
                elif field == 'tags': bad[index][field].append('#API')
                else: bad[index][field] += 'API'
                with self.subTest(version=index,field=field), self.assertRaisesRegex(ValueError,'风险词'):
                    copy.validate_posts({'posts':bad},5,'GLM5.3',copy_format='all_variations')
        long_bold=structured_post();long_bold['sections'][1]['text']='**'+('明确任务目标和验收要求'*3)+'**'
        self.assertIn('\n',copy.validate_posts({'posts':[long_bold]},1,'GLM5.3',copy_format='format_1')[0]['body'])
        mutations = [
            lambda p:p.update(copy_format='format_2'),
            lambda p:p['sections'].reverse(),
            lambda p:p.update(title='长'*26),
            lambda p:p.update(title='标题\t控制符'),
            lambda p:p['sections'][0].update(text='第一行\n第二行\n第三行'),
            lambda p:p['sections'][1].update(text='缺少加粗的核心卖点'),
            lambda p:p['sections'][2].update(text='只有一行价格反差'),
        ]
        for mutate in mutations:
            post=structured_post();mutate(post)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                copy.validate_posts({'posts':[post]},1,'GLM5.3',copy_format='format_1')
        post=structured_post('format_2');post['sections'][3]['text']='工具兼容情况待确认'
        with self.assertRaisesRegex(ValueError,'CC'):
            copy.validate_posts({'posts':[post]},1,'GLM5.3',copy_format='format_2')
        repeated_angles=[structured_post('format_1',n) for n in range(1,4)]
        repeated_angles[2]['angle']=repeated_angles[0]['angle']
        with self.assertRaisesRegex(ValueError,'不同结构'):
            copy.validate_posts({'posts':repeated_angles},3,'GLM5.3',copy_format='format_1')
        duplicate=structured_post();duplicate['angle']='另一角度'
        with self.assertRaisesRegex(ValueError,'正文重复'):
            copy.validate_posts({'posts':[structured_post(),duplicate]},2,'GLM5.3',copy_format='format_1')

    def test_small_copy_length_overages_are_trimmed_with_warnings(self):
        post = structured_post()
        post['sections'][0]['text'] = '开头内容需要稍微增加几个字，达到三十四字边界以上但仍然可以自然修剪完成'
        post['title'] = '标题长度刚刚超过二十字但没有达到严重超长范围'
        output = io.StringIO()
        with redirect_stdout(output):
            result = copy.validate_posts({'posts':[post]},1,'GLM5.3',copy_format='format_1')
        self.assertIn('WARN', output.getvalue())
        self.assertLessEqual(len(post['sections'][0]['text'].replace('\n','')),34)
        self.assertTrue(post['sections'][0]['text'].endswith(('，', ',', '？', '！', '?', '!')))
        self.assertEqual(len(post['title']),20)
        self.assertEqual(result[0]['body'].split('\n\n')[0], post['sections'][0]['text'])

        fallback = structured_post()
        fallback['sections'][0]['text'] = '开' * 35
        with redirect_stdout(io.StringIO()):
            copy.validate_posts({'posts':[fallback]},1,'GLM5.3',copy_format='format_1')
        self.assertEqual(fallback['sections'][0]['text'].replace('\n',''), '开' * 33 + '。')

        severe = structured_post()
        severe['sections'][0]['text'] = '开' * 46
        with redirect_stdout(io.StringIO()):
            copy.validate_posts({'posts':[severe]},1,'GLM5.3',copy_format='format_1')
        self.assertLessEqual(len(severe['sections'][0]['text'].replace('\n', '')), 34)
        self.assertTrue(severe['sections'][0]['text'].endswith(('，', '。', '！', '？', '；', '、', ',', ';', '!', '?')))

        wrapped = structured_post()
        wrapped['sections'][0]['text'] = '开头内容超过限制，仍然需要自然截断\n继续提供背景信息并保持完整\n末尾内容不应阻止自动修剪'
        with redirect_stdout(io.StringIO()):
            copy.validate_posts({'posts':[wrapped]},1,'GLM5.3',copy_format='format_1')
        self.assertLessEqual(len(wrapped['sections'][0]['text'].replace('\n', '')), 34)
        self.assertLessEqual(len(wrapped['sections'][0]['text'].splitlines()), 2)

    def test_multiple_images_multiplier_and_fixed_format_no_overwrite(self):
        settings={'CONTENT_OPS_API_KEY':'test','CONTENT_OPS_BASE_URL':'https://offline.invalid/v1'}
        for fmt,multiplier,platform in [('all_variations',5,'xhs'),('format_2',3,'xhs'),('format_3',1,'xhs'),('format_2',5,'xianyu')]:
            output=self.base/f'{fmt}-{multiplier}-{platform}'
            def text_call(system,user,*args):
                plan=json.loads(user)['copy_plan']
                return {'posts':[structured_post(p['copy_format'],(p['image_index']-1)*multiplier+p['copy_index']) for p in plan]},{}
            def image_call(*,output,**kwargs):
                Image.new('RGB',copy.poster_size(platform)).save(output)
                data=output.read_bytes()
                return {'width':copy.poster_size(platform)[0],'height':copy.poster_size(platform)[1],'bytes':len(data),'sha256':__import__('hashlib').sha256(data).hexdigest()}
            argv=['--model','GLM5.3','--platform',platform,'--count','2','--copy-format',fmt,'--copy-multiplier',str(multiplier),'--output',str(output)]
            with self.subTest(fmt=fmt), patch.object(gateway,'load_config',return_value=settings), \
                 patch.object(copy,'claude_call',side_effect=text_call) as calls, \
                 patch.object(copy,'visual_prompt_call',return_value=('工作台海报',{'model':'offline'})), \
                 patch.object(gateway,'generate_image',side_effect=image_call) as images, redirect_stdout(io.StringIO()):
                self.assertEqual(copy.main(argv),0)
                self.assertEqual(calls.call_count,2)
                self.assertEqual(images.call_count,2)
                self.assertEqual(len(list(output.glob('post-*-copy-*.md'))),2*multiplier)
                (output/'post-1-copy-1.md').unlink()
                self.assertEqual(copy.main([*argv,'--resume']),0)
                self.assertTrue((output/'post-1-copy-1.md').exists())
                self.assertEqual(images.call_count,2)
                self.assertEqual(calls.call_count,2)
                self.assertEqual(copy.main([*argv,'--resume','--copy-multiplier',str(2 if multiplier==1 else 1)]),1)
                self.assertEqual(copy.main([*argv,'--resume','--copy-format','format_1']),1)
                self.assertEqual(images.call_count,2)
                manifest=json.loads((output/'manifest.json').read_text())
                versions=[p for post in manifest['posts'] for p in post['copies']]
                self.assertEqual([p['copy_format'] for p in versions],[copy.format_for(fmt,i) for i in range(2*multiplier)])

    def test_invalid_count_fails_before_paid_call(self):
        with patch.object(copy, 'claude_call', side_effect=AssertionError('must not call')) as calls:
            with redirect_stdout(io.StringIO()):
                result = copy.main(['--model', 'GLM5.3', '--count', '0', '--output', str(self.base / 'batch')])
        self.assertEqual(result, 1)
        calls.assert_not_called()

    def test_invalid_facts_fail_before_paid_call(self):
        config = self.base / 'gateway.env'
        config.write_text('CONTENT_OPS_API_KEY=offline-placeholder\nCONTENT_OPS_BASE_URL=https://offline.invalid/v1\n')
        facts = self.base / 'facts.json'
        facts.write_text(json.dumps({'model': 'GLM5.3', 'verified_claims': [{'claim': 'missing source'}]}))
        with patch.object(copy, 'claude_call', side_effect=AssertionError('must not call')) as calls:
            with redirect_stdout(io.StringIO()):
                result = copy.main(['--model', 'GLM5.3', '--count', '1', '--facts', str(facts), '--config', str(config), '--output', str(self.base / 'batch')])
        self.assertEqual(result, 1)
        calls.assert_not_called()
        self.assertFalse((self.base / 'batch').exists())


class DoctorTests(unittest.TestCase):
    def test_staged_bytes_and_entry_allowlist(self):
        spec = importlib.util.spec_from_file_location('doctor', ROOT / 'scripts/doctor.py')
        doctor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(doctor)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / 'scripts').mkdir()
            (root / 'scripts/unapproved.py').write_text('x' * 1500)
            (root / 'large.txt').write_text('x' * 1500)
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            (root / 'large.txt').write_text('small working copy')
            budget = {'tracked_files_max': 10, 'tracked_kb_max': 100, 'single_file_kb_max': 1,
                      'scratch_kb_max': 100, 'duplicate_min_kb': 1, 'scripts_entry_allow': []}
            with patch.object(doctor, 'ROOT', root):
                report = doctor.check(budget, staged=True)
            self.assertFalse(report['ok'])
            self.assertEqual(len(report['duplicates']), 1)
            self.assertTrue(any('多出的入口' in error for error in report['errors']))
            self.assertTrue(any('large.txt' in error for error in report['errors']))


class PruneReferencesTests(unittest.TestCase):
    def fixture(self, root):
        (root / 'data/images/xhs/bb').mkdir(parents=True)
        (root / 'data/images/xhs/bb/1.png').write_bytes(b'unwanted')
        rows = [{'id':'aa','platform':'xhs','title':'keep'}, {'id':'bb','platform':'xhs'}, {'id':'cc','platform':'xianyu'}, {'id':'dd','platform':'other'}]
        raw = ''.join(json.dumps(row) + '\n' for row in rows).encode()
        (root / 'data/posts.jsonl').write_bytes(raw)
        (root / 'data/collections.json').write_text(json.dumps({'collections':[{'reference_ids':['aa','xianyu:bb']}]}))
        def git(*args):
            return subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True)
        git('init');git('add','data/posts.jsonl','data/collections.json')
        git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','初始测试')
        return raw, git

    def test_prune_whitelist_backup_and_seal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, git = self.fixture(root)
            with redirect_stdout(io.StringIO()):
                store.prune(['--root',str(root)])
            self.assertEqual((root/'data/posts.jsonl').read_bytes(),raw)
            with redirect_stdout(io.StringIO()):
                store.prune(['--root',str(root),'--apply'])
            self.assertEqual([row['id'] for row in store.read_posts(root/'data/posts.jsonl')],['aa','cc','dd'])
            self.assertEqual(next((root/'data').glob('posts.jsonl.bak.*')).read_bytes(),raw)
            self.assertFalse((root/'data/images/xhs/bb').exists())
            self.assertEqual(git('show','HEAD:data/posts.jsonl').stdout,(root/'data/posts.jsonl').read_bytes())
            self.assertFalse((root/'data/.posts.lock').exists())

    def test_prune_git_failure_restores_files_and_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, git = self.fixture(root)
            (root/'.git/index.lock').write_text('busy')
            with self.assertRaises(subprocess.CalledProcessError), redirect_stdout(io.StringIO()):
                store.prune(['--root',str(root),'--apply'])
            self.assertEqual((root/'data/posts.jsonl').read_bytes(),raw)
            self.assertEqual((root/'data/images/xhs/bb/1.png').read_bytes(),b'unwanted')
            self.assertFalse((root/'data/.posts.lock').exists())
            (root/'.git/index.lock').unlink()
            (root/'data/.posts.lock').write_text('do not break')
            with self.assertRaises(FileExistsError):
                store.prune(['--root',str(root),'--apply'])

    def test_prune_rejects_symlink_and_shared_image(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, git = self.fixture(root)
            rows = [json.loads(line) for line in raw.splitlines()]
            rows[2]['images']=['data/images/xhs/bb/1.png']
            (root/'data/posts.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in rows))
            with self.assertRaises(ValueError):
                store.prune(['--root',str(root),'--apply'])
            (root/'data/posts.jsonl').write_bytes(raw)
            shutil.rmtree(root/'data/images/xhs/bb')
            (root/'data/images/xhs/bb').symlink_to(root/'data',target_is_directory=True)
            with self.assertRaises(ValueError):
                store.prune(['--root',str(root),'--apply'])
            self.assertEqual((root/'data/posts.jsonl').read_bytes(),raw)


if __name__ == '__main__':
    unittest.main()
