// className 合併工具 (lightweight twMerge alternative)
type ClassValue = string | undefined | null | false | ClassValue[];

export function cn(...classes: ClassValue[]): string {
  return classes
    .flat(Infinity as 1)
    .filter(Boolean)
    .join(' ');
}
