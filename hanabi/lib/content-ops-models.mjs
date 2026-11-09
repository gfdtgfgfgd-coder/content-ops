// Product-model catalog derived from data/model-corpus.md — keep matching rules aligned with scripts/lib/copy.py.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EDITION_SUFFIXES = ['highspeed', 'preview', 'turbo', 'lite', 'plus', 'pro', 'max', 'mini'];
const SECTION_SPLIT = /\n(?=#\s+[一二三四五六七八九十0-9]+、)/u;
const HEADING = /^#\s+[一二三四五六七八九十0-9]+、|\s*语料库\s*$/gu;
const COVER = /^## \d+\. 封面吸睛大字与四大版式专属短词库\s*$/mu;
const ALIAS_LINE = /^>\s*型号别名[:：]\s*(.+)$/u;

export const modelKey = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/gu, '');
export const stripModelEditions = key => {
  let value = String(key || '');
  let changed = true;
  while (changed && value) {
    changed = false;
    for (const suffix of EDITION_SUFFIXES) {
      if (value.endsWith(suffix) && value.length > suffix.length) {
        value = value.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return value;
};

export function listProductModels(root) {
  let content = '';
  try { content = readFileSync(join(root, 'data/model-corpus.md'), 'utf8'); } catch { return []; }
  const models = [];
  for (const part of content.split(SECTION_SPLIT)) {
    const lines = part.split('\n');
    if (!lines[0] || !/^#\s+[一二三四五六七八九十0-9]+、/u.test(lines[0])) continue;
    const heading = lines[0].replace(HEADING, '').trim();
    if (!heading || heading.startsWith('全平台')) continue;
    const names = heading.split('/').map(item => item.trim()).filter(Boolean);
    if (!names.length) continue;
    const aliases = new Set([names[0], ...names, ...names.slice(1).map(suffix => `${names[0]} ${suffix}`)]);
    for (const line of lines.slice(1, 12)) {
      const match = line.trim().match(ALIAS_LINE);
      if (!match) continue;
      for (const alias of match[1].split(/[,，、;/|]+/u)) if (alias.trim()) aliases.add(alias.trim());
    }
    models.push({ id: names[0], aliases: [...aliases], hasCoverCorpus: COVER.test(part) });
  }
  return models;
}

export function resolveProductModel(model, models, { requireCover = false } = {}) {
  const raw = String(model || '').trim();
  if (!raw) throw Object.assign(new Error('模型名不能为空。'), { statusCode: 400 });
  if (!models.length) throw Object.assign(new Error('data/model-corpus.md 中没有可识别的产品型号专节。'), { statusCode: 400 });
  const available = models.map(item => item.id).join('、');
  const key = modelKey(raw);
  const exact = models.filter(item => item.aliases.some(alias => modelKey(alias) === key));
  let chosen;
  if (exact.length === 1) chosen = exact[0];
  else if (exact.length > 1) throw Object.assign(new Error(`型号「${raw}」同时命中多个语料专节：${exact.map(item => item.id).join('、')}。请填写完整正式名。`), { statusCode: 400 });
  else {
    // Strip editions only on catalog aliases so short inputs hit Pro editions, invented editions miss.
    const baseHits = models.filter(item => key && item.aliases.some(alias => stripModelEditions(modelKey(alias)) === key));
    if (baseHits.length === 1) chosen = baseHits[0];
    else if (baseHits.length > 1) throw Object.assign(new Error(`型号「${raw}」对应多个语料专节：${baseHits.map(item => item.id).join('、')}。请填写完整正式名。`), { statusCode: 400 });
    else throw Object.assign(new Error(`型号「${raw}」未匹配语料库。可用型号：${available}。请在 data/model-corpus.md 新增专节（含封面短词库与可选「型号别名」行），或改用上列正式名。`), { statusCode: 400 });
  }
  if (requireCover && !chosen.hasCoverCorpus) {
    throw Object.assign(new Error(`型号「${chosen.id}」缺少封面专属短词库；专节内须有「## N. 封面吸睛大字与四大版式专属短词库」。`), { statusCode: 400 });
  }
  return chosen.id;
}
