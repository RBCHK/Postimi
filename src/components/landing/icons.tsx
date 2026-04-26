/**
 * Icons used in the marketing landing.
 *
 * Most are re-exports from `lucide-react` (renamed to match the prototype's
 * names where they differ). The platform marks for X and Threads aren't in
 * lucide, so they're inlined as SVG. Stroke = currentColor, 24×24 viewBox.
 */
import {
  ArrowRight as ArrowRightIcon,
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  Send as SendIcon,
  Calendar as CalendarIcon,
  Target as TargetIcon,
  Mic as MicIcon,
  Sparkles as SparklesIcon,
  Plus as PlusIcon,
  PlayCircle as PlayCircleIcon,
  Linkedin as LinkedinIcon,
  Quote as QuoteIcon,
  type LucideProps,
} from "lucide-react";

export const ArrowRight = ArrowRightIcon;
export const Check = CheckIcon;
export const ChevronDown = ChevronDownIcon;
export const Send = SendIcon;
export const Calendar = CalendarIcon;
export const Target = TargetIcon;
export const Voice = MicIcon;
export const Sparkles = SparklesIcon;
export const Plus = PlusIcon;
export const PlayCircle = PlayCircleIcon;
export const Linkedin = LinkedinIcon;
export const Quote = QuoteIcon;

type SvgProps = Omit<LucideProps, "ref">;

export function XLogo({ size = 16, strokeWidth = 1.75, ...rest }: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M3 3l8 11L3 21h2.5l6.5-7.5L17 21h4l-8.5-12L20 3h-2.5L12 9.5 8 3z" />
    </svg>
  );
}

export function Threads({ size = 16, strokeWidth = 1.75, ...rest }: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 22a10 10 0 1 1 10-10 10 10 0 0 1-10 10z" />
      <path d="M16.5 11c-1-2-3-3-5-2.5-1.5.5-2 2-1 3s4 .5 4-1.5" />
    </svg>
  );
}
