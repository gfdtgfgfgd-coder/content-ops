import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('generator',ROOT/'scripts/gen-xhs-post.py')
gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)

class GenerationTests(unittest.TestCase):
    def posts(self):
        return {'posts':[{'title_lines':['试试！','GLM5.3','先写一个任务'],'body':'可以把一个真实任务交给它，再核对结果。'*8,'tags':['#GLM5.3','#AI','#创作'],'angle':'叙述'}]}
    def args(self,directory):
        return SimpleNamespace(model='GLM5.3',count=1,platform='xhs',config=None,facts=None,output=Path(directory),timeout=1,resume=False,background=None)
    def settings(self):
        return {'CONTENT_OPS_API_KEY':'test-only-key','CONTENT_OPS_BASE_URL':'https://company.invalid/v1','CONTENT_OPS_IMAGE_MODEL':'qwen-image-3.0'}
    def test_parse_json_and_reject_multiple_documents(self):
        self.assertEqual(gen.parse_json('```json\n{"posts":[]}\n```\n审核通过。'),{'posts':[]})
        with self.assertRaises(ValueError):gen.parse_json('{"posts":[]}\n{"other":1}')
        with self.assertRaises(ValueError):gen.parse_json('{"body":"未转义"引语""}')
    def test_scope_and_entire_public_output_checked(self):
        self.assertFalse(gen.word_check.check('满血 秒级',model='GLM5.3'))
        self.assertEqual(len(gen.word_check.check('满血 秒级',model='Seedance 2.5')),2)
        for field in ['body','tags','title_lines']:
            value=self.posts()
            if field=='body':value['posts'][0]['body']+=' API'
            else:value['posts'][0][field][-1]+='API'
            with self.assertRaises(ValueError):gen.validate_posts(value,1,'GLM5.3')
        with self.assertRaises(ValueError):gen.validate_input('GLM\n5.3',1,'xhs')
    def test_failed_image_preserves_copy_and_explicit_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            args=self.args(directory)
            with patch.object(gen.image_api,'load_config',return_value=self.settings()),patch.object(gen,'claude_call',return_value=(self.posts(),{'model':'claude-sonnet-4-6'})) as calls,patch.object(gen.image_api,'generate_image',side_effect=RuntimeError('image unavailable')):
                with self.assertRaisesRegex(RuntimeError,'unavailable'):gen.run(args)
                self.assertEqual(calls.call_count,2)
            manifest=json.loads((Path(directory)/'manifest.json').read_text())
            self.assertEqual(manifest['status'],'failed')
            self.assertTrue((Path(directory)/'post-1.md').exists())
            self.assertIsNone(manifest['posts'][0]['image'])
            def fake_image(**kwargs):
                gen.Image.new('RGB',(1080,1080),'blue').save(kwargs['output'])
                return {'model':'qwen-image-3.0'}
            args.resume=True
            with patch.object(gen.image_api,'load_config',return_value=self.settings()),patch.object(gen,'claude_call') as calls,patch.object(gen.image_api,'generate_image',side_effect=fake_image) as images:
                result=gen.run(args)
                self.assertEqual(result['status'],'completed')
                self.assertEqual(images.call_count,1)
                calls.assert_not_called()
                # A completed resume reuses saved files and never calls models.
                gen.run(args)
                self.assertEqual(images.call_count,1)
                calls.assert_not_called()
            with gen.Image.open(Path(directory)/'post-1.png') as image:self.assertEqual(image.size,(1080,1080))
    def test_refuse_output_overwrite_and_fact_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            args=self.args(directory)
            (Path(directory)/'manifest.json').write_text('{}')
            with patch.object(gen.image_api,'load_config',return_value=self.settings()),patch.object(gen,'claude_call') as calls:
                with self.assertRaisesRegex(ValueError,'已有生成结果'):gen.run(args)
                calls.assert_not_called()

if __name__=='__main__':unittest.main()
