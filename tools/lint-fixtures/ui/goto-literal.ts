declare function goto(path: string): Promise<void>;
export const a = () => goto('/login');
export const b = (path: string) => goto(path);
