"""Reference-driven paper surfaces. Recipe source: config/bold-typo-backgrounds.json."""
from __future__ import annotations
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import random
import re
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[2]
RECIPE = ROOT/'config/bold-typo-backgrounds.json'


@lru_cache(maxsize=1)
def recipe():
    return json.loads(RECIPE.read_text())


def recipe_hash():
    return hashlib.sha256(RECIPE.read_bytes()).hexdigest()


def style_options():
    return [{'id': p['id'], 'name': p['label'], 'material': p['prompt']} for p in recipe()['profiles']]


def normalize_style(style=None, visual_prompt=''):
    profiles = {p['id']: p for p in recipe()['profiles']}
    if style is not None and not isinstance(style, dict):
        raise ValueError('大字报background_style须为对象')
    style = dict(style or {})
    profile_id = style.get('profile')
    if profile_id is None:
        # Legacy visual plans keep working; explicit new plans use a validated profile ID.
        profile_id = next((p['id'] for p in recipe()['profiles'][1:] if any(word in visual_prompt for word in p['keywords'])), recipe()['default'])
    if profile_id not in profiles:
        raise ValueError('大字报背景材质不在已配置配方中')
    profile = profiles[profile_id]
    result = {'profile': profile_id}
    for key in ('base', 'paper', 'ink', 'accent'):
        value = style.get(key) if style.get(key) is not None else profile.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise ValueError('大字报背景颜色须为#RRGGBB')
        result[key] = value.upper()
    roles = style.get('highlight_roles', profile['highlight_roles'])
    if not isinstance(roles, list) or len(roles) > 3 or any(role not in ('hook','benefit','model','payoff') for role in roles) or len(roles) != len(set(roles)):
        raise ValueError('大字报高亮角色无效')
    result['highlight_roles'] = roles
    description = style.get('description', profile['prompt'])
    if not isinstance(description, str) or not description.strip() or len(description) > 1200 or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', description):
        raise ValueError('大字报背景材质说明无效')
    result['description'] = description.strip()
    return result


def luminance(color):
    values = [n/255 for n in ImageColor.getrgb(color)]
    values = [n/12.92 if n <= .04045 else ((n+.055)/1.055)**2.4 for n in values]
    return sum(n*w for n,w in zip(values, (.2126,.7152,.0722)))


def contrast(first, second):
    a,b = sorted((luminance(first),luminance(second)))
    return (b+.05)/(a+.05)


def readable_ink(background, preferred):
    if contrast(background, preferred) >= recipe()['render']['contrast_min']:
        return preferred
    return max(('#17191B','#F5F6F0'), key=lambda ink: contrast(background,ink))


def render_surface(source, size, style=None, seed=''):
    """Keep AI material shading, tint it to the observed palette, and add reproducible surface detail."""
    style = normalize_style(style)
    config = recipe()['render']
    profile = next(p for p in recipe()['profiles'] if p['id'] == style['profile'])
    material = profile['material']
    width,height = size
    gray = ImageOps.grayscale(ImageOps.fit(source.convert('RGB'),size))
    source_std = ImageStat.Stat(gray).stddev[0]
    flat = source_std < 3
    rng = random.Random(hashlib.sha256((str(seed)+json.dumps(style,sort_keys=True)).encode()).hexdigest())
    noise_size = (max(64,width//2),max(64,height//2))
    grain = Image.frombytes('L', noise_size, bytes(max(0,min(255,round(235+rng.gauss(0,config['grain'])))) for _ in range(noise_size[0]*noise_size[1])))
    grain = grain.resize(size,Image.Resampling.BICUBIC)
    # Autocontrast is only used when there is real material information to preserve.
    ai_shade = ImageOps.autocontrast(gray,cutoff=1) if not flat else Image.new('L',size,220)
    ai_shade = ImageOps.colorize(ai_shade,'#828282','#FFFFFF').convert('L')
    shade = Image.blend(grain,ai_shade,config['ai_texture_strength'] if not flat else 0)

    if material in ('creased','shadow'):
        relief = Image.new('L',size,235)
        draw = ImageDraw.Draw(relief)
        if material == 'creased':
            # Low-frequency triangular folds, with small edge highlights and shallow shadows.
            columns,rows = 5,7
            points = [[(round((x+rng.uniform(-.35,.35))*width/(columns-1)),round((y+rng.uniform(-.3,.3))*height/(rows-1))) for x in range(columns)] for y in range(rows)]
            for y in range(rows-1):
                for x in range(columns-1):
                    a,b,c,d = points[y][x],points[y][x+1],points[y+1][x],points[y+1][x+1]
                    draw.polygon((a,b,c),fill=rng.randint(155,255));draw.polygon((b,c,d),fill=rng.randint(155,255))
                    draw.line((b,c),fill=rng.randint(155,190),width=max(1,width//600))
                    draw.line(((b[0]+2,b[1]+2),(c[0]+2,c[1]+2)),fill=255,width=max(1,width//550))
            relief = relief.filter(ImageFilter.GaussianBlur(max(.6,width/1200)))
        else:
            for _ in range(7):
                x,y = rng.randrange(width),rng.randrange(height)
                radius = rng.randrange(max(1,width//5),max(2,width//2))
                draw.ellipse((x-radius,y-radius,x+radius,y+radius),fill=rng.randint(115,195))
            relief = relief.filter(ImageFilter.GaussianBlur(width*.075))
        shade = Image.blend(shade,relief,config['crease_strength'] if material=='creased' else .32)

    def tint(color):
        base = Image.new('RGB',size,color)
        # Colored material remains visible across the full canvas, including under the lettering.
        return Image.blend(base,ImageChops.multiply(base,shade.convert('RGB')),.72)

    image = tint(style['base'])
    grid_step = max(16,round(width*config['grid_step_ratio']))
    if material in ('grid','notebook'):
        layer = Image.new('RGBA',size)
        draw = ImageDraw.Draw(layer)
        line = (255,255,255,20) if material=='grid' else (42,106,172,38)
        for x in range(0,width,grid_step): draw.line((x,0,x,height),fill=line,width=1)
        for y in range(0,height,grid_step): draw.line((0,y,width,y),fill=line,width=1)
        image = Image.alpha_composite(image.convert('RGBA'),layer).convert('RGB')
    if material in ('shadow','notebook'):
        inset = round(width*config['paper_inset_ratio'])
        mask = Image.new('L',size);draw = ImageDraw.Draw(mask)
        draw.rectangle((inset,inset,width-inset,height-inset),fill=255)
        shadow = Image.new('RGBA',size);shadow_draw=ImageDraw.Draw(shadow)
        shadow_draw.rectangle((inset+8,inset+12,width-inset+8,height-inset+12),fill=(20,35,45,45))
        image = Image.alpha_composite(image.convert('RGBA'),shadow.filter(ImageFilter.GaussianBlur(12))).convert('RGB')
        # The paper itself is textured, rather than an opaque white cover that erases the AI layer.
        image = Image.composite(tint(style.get('paper',style['base'])),image,mask)
        if material=='notebook':
            draw=ImageDraw.Draw(image)
            for y in range(round(height*.12),round(height*.92),round(height*.09)):
                x=round(width*.105);r=round(width*.012)
                draw.ellipse((x-r,y-r,x+r,y+r),fill=style['base'])
                draw.arc((x-r*3,y-r,x+r,y+r),60,300,fill=style['base'],width=max(2,r//3))
    # Small abstract corner marks are original geometric decorations, never copied from a reference.
    draw=ImageDraw.Draw(image)
    if material=='creased':
        for i in range(3):
            x=round(width*(.86+i*.018));y=round(height*.065);s=round(width*.018)
            draw.line(((x,y),(x+s,y+s),(x,y+s*2)),fill=style['accent'],width=max(2,width//180))
    else:
        x,y=round(width*.86),round(height*.91);s=round(width*.022)
        draw.line(((x-s,y),(x+s,y)),fill=style['accent'],width=max(2,width//180))
        draw.line(((x,y-s),(x,y+s)),fill=style['accent'],width=max(2,width//180))
    return image, {'profile':style['profile'],'label':profile['label'],'style':style,
                   'text_surface_color':style.get('paper',style['base']) if material in ('shadow','notebook') else style['base'],
                   'recipe_sha256':recipe_hash(),'source_luminance_std':round(source_std,3),'flat_ai_background':flat,
                   'material_source':'ai_shading_and_local_surface' if not flat else 'local_surface_over_flat_ai_background'}
