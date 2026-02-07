declare module "*.css" {
  const classes: { [key: string]: string };
  export default classes;
}

declare module "ags" {
  export const For: any;
  export const This: any;
  export const With: any;
  export const onCleanup: any;

  // NEW: The state management function
  export function createState<T>(initialValue: T): [
    (transform?: (value: T) => any) => any, // The Getter / Binding
    (newValue: T | ((prev: T) => T)) => void, // The Setter
  ];

  const _default: any;
  export default _default;
}

declare module "ags/*" {
  const mod: any;
  export = mod;
}

declare module "ags/time" {
  export const createPoll: any;
  const _default: any;
  export default _default;
}

declare module "ags/process" {
  export const execAsync: any;
  const _default: any;
  export default _default;
}

declare module "@girs/*" {
  const mod: any;
  export = mod;
}
