// Register bahasa (FSD F-02.4) — mengunci sapaan & kata ganti di seluruh segmen (L-16).

export type Register = "bunda" | "bestie" | "genz" | "netral";

export interface RegisterSpec {
  code: Register;
  sapaan: string; // sapaan khas pembuka
  me: string; // kata ganti orang pertama
  you: string; // kata ganti orang kedua
  genzStyle: boolean;
}

export const REGISTERS: Record<Register, RegisterSpec> = {
  bunda: { code: "bunda", sapaan: "Bun", me: "aku", you: "kamu", genzStyle: false },
  bestie: { code: "bestie", sapaan: "Say", me: "aku", you: "kamu", genzStyle: false },
  genz: { code: "genz", sapaan: "Cuy", me: "gue", you: "lo", genzStyle: true },
  netral: { code: "netral", sapaan: "Kak", me: "aku", you: "kamu", genzStyle: false },
};

export const DEFAULT_REGISTER_BY_CATEGORY: Record<string, Register> = {
  beauty: "bestie",
  fashion: "bestie",
  muslim_fashion: "bunda",
  home: "bunda",
  kitchen: "bunda",
  kids: "bunda",
  gadget: "genz",
  food: "genz",
  default: "netral",
};
