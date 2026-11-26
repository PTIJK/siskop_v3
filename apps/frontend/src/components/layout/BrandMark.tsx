export function BrandMark({ className = "h-[30px] w-[30px]", alt = "" }: { className?: string; alt?: string }) {
  return <img src="/nexcoop-mark.png" width={30} height={30} alt={alt} className={`${className} shrink-0 object-contain`} />;
}
