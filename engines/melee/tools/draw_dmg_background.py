"""Render the Finder installation background using the bundled OFL Kanit fonts."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
S = 2
image = Image.new("RGB", (640*S, 400*S), "#f4f0e8")
draw = ImageDraw.Draw(image)
def box(coords, fill): draw.rectangle(tuple(int(v*S) for v in coords), fill=fill)
def text(x,y,value,size,color,bold=False):
    font=ImageFont.truetype(str(ROOT/"web/public/brand/kanit"/("Kanit-SemiBold.ttf" if bold else "Kanit-Regular.ttf")),size*S)
    draw.text((x*S,y*S),value,font=font,fill=color)
box((0,0,640,118),"#181611")
box((32,30,36,88),"#efa943")
text(50,21,"OPENSMASH",30,"#faf4e6",True)
text(51,59,"M E L E E",18,"#efa943",True)
text(522,45,"FOR MAC",13,"#c7bcaa")
text(143,133,"Drag the app into Applications",21,"#342d22",True)
# Finder supplies the real application and Applications folder icons at y=226.
draw.line([(284*S,226*S),(350*S,226*S)],fill="#b17932",width=3*S)
draw.line([(337*S,213*S),(350*S,226*S),(337*S,239*S)],fill="#b17932",width=3*S)
box((32,327,608,328),"#d8cec0")
text(117,344,"Then open OpenSmash Melee from Applications.",15,"#655a49")
out=ROOT/"desktop/installer"
image.save(out/"dmg-background@2x.png")
image.resize((640,400),Image.Resampling.LANCZOS).save(out/"dmg-background.png")
