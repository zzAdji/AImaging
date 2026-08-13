export interface CommandSuggestion {
  name: string;
  usage: string;
  description: string;
}

export const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  { name: "analyze", usage: "@analyze image:<id>|all", description: "Analyse une image ou l'examen." },
  { name: "predict", usage: "@predict image:<id>|all", description: "Lance la classification." },
  { name: "gradcam", usage: "@gradcam image:<id> opacity:62", description: "Calcule et affiche une Grad-CAM." },
  { name: "wl", usage: "@wl preset:lung", description: "Applique un fenêtrage." },
  { name: "brightness", usage: "@brightness value:65", description: "Règle la luminosité." },
  { name: "contrast", usage: "@contrast value:70", description: "Règle le contraste." },
  { name: "invert", usage: "@invert value:true", description: "Inverse l'image." },
  { name: "annotation", usage: "@annotation text:\"À relire\" x:240 y:380 color:#f97316 size:18", description: "Crée une annotation." },
  { name: "measure", usage: "@measure x1:120 y1:300 x2:780 y2:300 width:3", description: "Crée une mesure." },
  { name: "layer", usage: "@layer layer:annotations visible:true opacity:100", description: "Modifie une couche." },
  { name: "report", usage: "@report", description: "Génère un rapport." },
  { name: "help", usage: "@help", description: "Affiche les commandes." },
];

export function isExplicitCommand(value: string): boolean {
  return value.trimStart().startsWith("@");
}

export function commandSuggestions(value: string): CommandSuggestion[] {
  if (!isExplicitCommand(value)) return [];
  const command = value.trimStart().slice(1).split(/\s/, 1)[0]?.toLowerCase() ?? "";
  return COMMAND_SUGGESTIONS.filter((item) => item.name.startsWith(command)).slice(0, 6);
}

export function completeCommand(value: string, suggestion: CommandSuggestion): string {
  const rest = value.trimStart().slice(1);
  return !rest || !/\s/.test(rest) ? suggestion.usage : value;
}
