declare module "*.css" {
  const classes: { [key: string]: string };
  export default classes;
}
declare module "ags" {
  export const For: any;
  export const This: any;
  export const With: any;
  export const onCleanup: any;
  export const App: any;
  export const Astal: any;
  export const Gtk: any;
  export const Gdk: any;

  export function createState<T>(
    initialValue: T,
  ): [
    (transform?: (value: T) => any) => any,
    (newValue: T | ((prev: T) => T)) => void,
  ];

  const _default: any;
  export default _default;
}

declare module "ags/gtk4/app" {
  export const App: any;
  const _default: any;
  export default _default;
}

declare module "ags/time" {
  export const createPoll: any;
  export const timeout: any;
  export const interval: any;
  const _default: any;
  export default _default;
}

declare module "ags/process" {
  export const execAsync: any;
  export const exec: any;
  const _default: any;
  export default _default;
}

declare module "ags/*" {
  const mod: any;
  export = mod;
}

declare module "@girs/*" {
  const mod: any;
  export = mod;
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      $?: (self: any) => void;
      setup?: (self: any) => void;
    }
  }
}
export {};
