import { useEffect, useRef } from 'react';
import { ShaderMount, meshGradientFragmentShader, getShaderColorFromString } from '@paper-design/shaders';
import { orbPaint, type OrbSettings } from './orb-settings';

type Entry = { canvas: HTMLCanvasElement; settings: OrbSettings; visible: boolean; key: string; painted: boolean };
const entries = new Set<Entry>();
let mount: ShaderMount | undefined;
let host: HTMLDivElement | undefined;
let frame = 0;
// Asked for stillness, a badge is drawn once and then left alone: every frame
// would be the same frame, and the loop that would repaint it finds nothing to
// do. Everything else swirls, a touch device at half the cadence — nobody reads
// the turn of an eighteen pixel badge, and a phone has better uses for a frame.
export const still = () => {
  if (boardStill) return true;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
// The board holds every badge still while it is zoomed out or crowded, the
// way it stills the agents' faces: dozens of swirling badges nobody can read
// at that size cost a copy each every frame.
let boardStill = false;
export function setOrbsStill(next: boolean) { boardStill = next; }
const cadence = () => {
  try { return matchMedia('(pointer: coarse)').matches ? 80 : 40; } catch { return 40; }
};
// The way back to no canvas at all, without a deploy: a device that cannot hold
// the badges says so here and gets them painted in CSS instead.
const painted = () => {
  try { return localStorage.getItem('wireal.orbs') === 'css'; } catch { return false; }
};
const paletteKey = (s: OrbSettings) => JSON.stringify(s);
function uniforms(s: OrbSettings) {
  return {u_colors:s.colors.map(getShaderColorFromString),u_colorsCount:3,u_distortion:s.distortion,u_swirl:s.swirl,u_grainMixer:0,u_grainOverlay:0,u_fit:0,u_scale:1,u_rotation:0,u_originX:.5,u_originY:.5,u_offsetX:0,u_offsetY:0,u_worldWidth:0,u_worldHeight:0};
}
const plates = new Map<string,HTMLCanvasElement>();
function plate(key: string, source: HTMLCanvasElement): HTMLCanvasElement | undefined {
  let held = plates.get(key);
  if (!held) { held = document.createElement('canvas'); plates.set(key, held); }
  if (held.width !== source.width || held.height !== source.height) { held.width = source.width; held.height = source.height; }
  const ctx = held.getContext('2d');
  if (!ctx) return undefined;
  ctx.clearRect(0,0,held.width,held.height);
  ctx.drawImage(source,0,0);
  return held;
}
function start() {
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;width:128px;height:128px;pointer-events:none';
  host.setAttribute('aria-hidden','true');
  host.dataset.orbRenderer = 'shared';
  document.body.append(host);
  try { mount = new ShaderMount(host, meshGradientFragmentShader, uniforms([...entries][0].settings), {preserveDrawingBuffer:true}, 0); } catch { mount = undefined; }
  let last = -100;
  function render(time:number) {
    frame = requestAnimationFrame(render);
    if (document.hidden || time-last < cadence()) return;
    const quiet = still();
    // Render each palette once, then copy it to all matching badges.
    const groups = new Map<string,Entry[]>();
    for (const e of entries) if(e.visible && !(quiet && e.painted)) groups.set(e.key,[...(groups.get(e.key) ?? []),e]);
    if(!groups.size) return;
    last = time;
    for(const group of groups.values()) {
      const s=group[0].settings;
      mount?.setUniforms(uniforms(s));
      mount?.setFrame(s.phase*1000+(quiet?0:time*s.speed));
      // Every badge of a palette is the same picture. Copying it off the shader
      // canvas once a badge asks the GPU to stop and hand it over seventy times
      // a frame; copying it once onto a plate and dealing that out asks once.
      const drew=Boolean(mount?.canvasElement.width) && plate(group[0].key,mount!.canvasElement);
      for(const entry of group) {
        const {canvas}=entry;
        const ctx=canvas.getContext('2d'); if(!ctx)continue;
        const n=canvas.width;
        ctx.clearRect(0,0,n,n); ctx.save(); ctx.beginPath();ctx.arc(n/2,n/2,n/2,0,Math.PI*2);ctx.clip();
        if(drew) {ctx.drawImage(drew,0,0,n,n);canvas.dataset.renderer='shader';}
        else {const g=ctx.createLinearGradient(0,0,n,n);s.colors.forEach((c,i)=>g.addColorStop(i/2,c));ctx.fillStyle=g;ctx.fillRect(0,0,n,n);canvas.dataset.renderer='fallback';}
        ctx.restore();
        entry.painted=Boolean(drew)||!mount;
      }
    }
  }
  frame=requestAnimationFrame(render);
}
export function FluidOrb({settings,size=18,label='Color'}:{settings:OrbSettings;size?:number;label?:string}) {
  if (painted()) return <PaintedOrb settings={settings} size={size} label={label} />;
  return <ShadedOrb settings={settings} size={size} label={label} />;
}
function PaintedOrb({settings,size,label}:{settings:OrbSettings;size:number;label:string}) {
  return <span role="img" aria-label={label} data-testid="fluid-orb" data-renderer="css" style={{width:size,height:size,flexShrink:0,borderRadius:'50%',backgroundImage:orbPaint(settings)}} />;
}
function ShadedOrb({settings,size,label}:{settings:OrbSettings;size:number;label:string}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const entry:Entry={canvas:ref.current!,settings,visible:true,key:paletteKey(settings),painted:false};entries.add(entry);
    const observer=new IntersectionObserver(([value])=>{entry.visible=value.isIntersecting;});observer.observe(entry.canvas);
    if(!host)start();
    return()=>{observer.disconnect();entries.delete(entry);if(!entries.size){cancelAnimationFrame(frame);mount?.dispose();mount=undefined;host?.remove();host=undefined;plates.clear();}};
  },[settings]);
  return <canvas ref={ref} role="img" aria-label={label} data-testid="fluid-orb" width={size*2} height={size*2} style={{width:size,height:size,flexShrink:0}} />;
}
