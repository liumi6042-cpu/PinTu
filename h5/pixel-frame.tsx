import {forwardRef,type ComponentPropsWithoutRef} from 'react';

export type PixelTone='cream'|'berry'|'gold';
export type PixelFrameScale=1|2;
type PixelFrameOptions={tone?:PixelTone;frameScale?:PixelFrameScale};
export type PixelFrameProps=ComponentPropsWithoutRef<'div'> & Omit<PixelFrameOptions,'tone'> & {tone?:'cream'|'gold'};
export type PixelButtonProps=ComponentPropsWithoutRef<'button'> & PixelFrameOptions;

const frameClass=(base:string,className?:string)=>className?base+' '+className:base;

/** A native layout container; nine-slice paint is supplied by the shared styles. */
export const PixelFrame=forwardRef<HTMLDivElement,PixelFrameProps>(function PixelFrame(
 {tone='cream',frameScale=1,className,...props},ref,
){
 return <div {...props} ref={ref} className={frameClass('pixel-frame',className)} data-pixel-frame="panel" data-pixel-tone={tone} data-pixel-scale={frameScale}/>;
});

/** Native button behavior, events and ARIA states pass through unchanged. */
export const PixelButton=forwardRef<HTMLButtonElement,PixelButtonProps>(function PixelButton(
 {tone='cream',frameScale=1,className,type='button',...props},ref,
){
 return <button {...props} ref={ref} type={type} className={frameClass('pixel-button',className)} data-pixel-frame="button" data-pixel-tone={tone} data-pixel-scale={frameScale}/>;
});