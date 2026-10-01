export type OrbSettings = { colors: [string,string,string]; speed:number; distortion:number; swirl:number; phase:number };
export function makeOrb(color:string):OrbSettings {return {colors:[color,'#d6ecff','#292139'],speed:0.65,distortion:0.75,swirl:0.55,phase:20};}
function randomColor() {
  const channel = () => Math.floor(72 + Math.random() * 168).toString(16).padStart(2, "0");
  return `#${channel()}${channel()}${channel()}`;
}
export function randomOrb(): OrbSettings {
  return {
    colors: [randomColor(), randomColor(), randomColor()],
    speed: Number((0.35 + Math.random() * 0.9).toFixed(2)),
    distortion: Number((0.35 + Math.random() * 0.55).toFixed(2)),
    swirl: Number((0.2 + Math.random() * 0.65).toFixed(2)),
    phase: Math.floor(Math.random() * 101),
  };
}
export const defaultStatusOrbs={proposed:makeOrb('#a78bfa'),todo:makeOrb('#9aacc4'),doing:makeOrb('#efb94b'),done:makeOrb('#45d797')};
export const wholeMapOrb:OrbSettings={colors:['#000000','#ffffff','#ffffff'],speed:.18,distortion:.28,swirl:.2,phase:0};
export const orbPresets=[
  {name:'Jade',orb:makeOrb('#45d797')},
  {name:'Ocean',orb:{...makeOrb('#408cff'),colors:['#408cff','#6bf1db','#241a63'] as [string,string,string]}},
  {name:'Amber',orb:{...makeOrb('#ffb33e'),colors:['#ffb33e','#ffe8a2','#bf4178'] as [string,string,string]}},
  {name:'Rose',orb:{...makeOrb('#ef6387'),colors:['#ef6387','#ffc8ad','#673acc'] as [string,string,string]}},
];
export function validOrb(value:unknown):value is OrbSettings {
  if(!value||typeof value!=='object')return false;
  const v=value as OrbSettings;
  return Array.isArray(v.colors)&&v.colors.length===3&&v.colors.every(c=>/^#[a-f\d]{6}$/i.test(c))&&Number.isFinite(v.speed)&&v.speed>=0&&v.speed<=2&&Number.isFinite(v.distortion)&&v.distortion>=0&&v.distortion<=1&&Number.isFinite(v.swirl)&&v.swirl>=0&&v.swirl<=1&&Number.isFinite(v.phase)&&v.phase>=0&&v.phase<=100;
}

export function orbPaint(s: OrbSettings): string {
  const [a,b,c] = s.colors;
  const turn = (s.phase % 100) / 100;
  const at = (x:number,y:number) => `${Math.round((x + turn * 18) % 100)}% ${Math.round((y + turn * 12) % 100)}%`;
  // A CSS gradient fading to `transparent` fades through transparent black,
  // which turns three clean colours into mud. It fades to its own colour at
  // zero alpha instead, which is the same hue all the way out.
  const gone = (colour: string) => `${colour}00`;
  return [
    `radial-gradient(circle at ${at(30,24)}, ${b} 0%, ${gone(b)} 46%)`,
    `radial-gradient(circle at ${at(76,34)}, ${a} 0%, ${gone(a)} 68%)`,
    `radial-gradient(circle at ${at(44,88)}, ${c} 0%, ${gone(c)} 74%)`,
    `linear-gradient(145deg, ${a} 0%, ${c} 100%)`,
  ].join(',');
}
