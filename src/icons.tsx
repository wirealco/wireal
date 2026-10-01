import type { ComponentType, SVGProps } from "react";
import {
  SquareDashed,
  Hand as GravityHand,
  ArrowsExpand,
  ArrowChevronDown,
  ChevronDown as GravityChevronDown,
  ArrowsRotateRight,
  ArrowDownToLine as GravityArrowDownToLine,
  ArrowRight as GravityArrowRight,
  ArrowUpFromLine as GravityArrowUpFromLine,
  ArrowUpRightFromSquare,
  ArrowUturnCcwRight,
  ArrowUturnCwRight,
  Bars,
  Book as GravityBook,
  BranchesRight,
  Circle as GravityCircle,
  CircleCheck as GravityCircleCheck,
  Circles5Random,
  ClockArrowRotateLeft,
  Code,
  CodeCommitHorizontal,
  CodeFork,
  Cube as GravityCube,
  CircleInfo,
  Copy as GravityCopy,
  Envelope,
  Eye as GravityEye,
  EyeClosed,
  Funnel as GravityFunnel,
  Gear,
  GearBranches,
  Globe as GravityGlobe,
  LayoutCells,
  LayoutList,
  LayoutSideContentLeft,
  Layers,
  Link as GravityLink,
  LinkSlash,
  LogoGithub,
  Magnifier,
  Lock as GravityLock,
  LockOpen,
  Minus as GravityMinus,
  Pencil as GravityPencil,
  Person as GravityPerson,
  PersonGear,
  PlugConnection,
  Plus as GravityPlus,
  Display as GravityDisplay,
  Moon as GravityMoon,
  Sun as GravitySun,
  ArrowRightFromSquare,
  TrashBin,
  Xmark,
  Ellipsis,
} from "@gravity-ui/icons";

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function icon(Component: ComponentType<SVGProps<SVGSVGElement>>) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return <Component width={size} height={size} {...props} />;
  };
}

export const ArrowDownToLine = icon(GravityArrowDownToLine);
export const ArrowRight = icon(GravityArrowRight);
export const ChevronDown = icon(ArrowChevronDown);
export const Caret = icon(GravityChevronDown);
export const ArrowUpFromLine = icon(GravityArrowUpFromLine);
export const ArrowUpRight = icon(ArrowUpRightFromSquare);
export const Book = icon(GravityBook);
export const Box = icon(GravityCube);
export const Circle = icon(GravityCircle);
export const CircleCheck = icon(GravityCircleCheck);
export const Code2 = icon(Code);
export const Dices = icon(Circles5Random);
export const EyeOff = icon(EyeClosed);
export const Eye = icon(GravityEye);
export const Funnel = icon(GravityFunnel);
export const GitBranch = icon(BranchesRight);
export const History = icon(ClockArrowRotateLeft);
export const GitCommitHorizontal = icon(CodeCommitHorizontal);
export const GitFork = icon(CodeFork);
export const Layers2 = icon(Layers);
export const LayoutTemplate = icon(LayoutCells);
export const List = icon(LayoutList);
export const Maximize = icon(ArrowsExpand);
export const Menu = icon(Bars);
export const Minus = icon(GravityMinus);
export const Network = icon(GearBranches);
export const PanelLeftClose = icon(LayoutSideContentLeft);
export const PanelLeftOpen = icon(LayoutSideContentLeft);
export const Pencil = icon(GravityPencil);
export const Person = icon(GravityPerson);
export const Plus = icon(GravityPlus);
export const Display = icon(GravityDisplay);
export const Moon = icon(GravityMoon);
export const Sun = icon(GravitySun);
export const Redo2 = icon(ArrowUturnCwRight);
export const Settings2 = icon(Gear);
export const Trash2 = icon(TrashBin);
export const Undo2 = icon(ArrowUturnCcwRight);
export const Unlink = icon(LinkSlash);
export const X = icon(Xmark);
export const MoreHorizontal = icon(Ellipsis);
export const Globe = icon(GravityGlobe);
export const Mail = icon(Envelope);
export const Lock = icon(GravityLock);
export const Unlock = icon(LockOpen);
export const Link2 = icon(GravityLink);
export const LogOut = icon(ArrowRightFromSquare);
export const GitHubMark = icon(LogoGithub);
export const UserCog = icon(PersonGear);

export const Plug = icon(PlugConnection);
export const Search = icon(Magnifier);
export const Refresh = icon(ArrowsRotateRight);
export const Copy = icon(GravityCopy);
export const Info = icon(CircleInfo);
export const SelectArea = icon(SquareDashed);
export const Hand = icon(GravityHand);

export function GoogleMark({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
