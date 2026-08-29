/**
 * Catálogo estático extensible de aplicaciones soportadas por el módulo RAG.
 *
 * Cada entrada define:
 *  - key: identificador canónico en minúsculas (usado como `tool` en la tabla `documents`).
 *  - displayName: nombre humano-legible.
 *  - version: versión objetivo (informativa, se persiste en cada chunk).
 *  - officialDomains: lista de dominios oficiales usados con Tavily `include_domains`
 *    para restringir la ingesta a fuentes autoritativas.
 *  - seedTopics: temas iniciales que se usan como consultas Tavily por defecto
 *    cuando `ingestApp` se invoca sin `topics` explícitos.
 *
 * Ampliar por PR: agregar nuevas entradas al mapa `APP_CATALOG` y, si aplica,
 * enriquecer los dominios oficiales (nunca añadir dominios de terceros no oficiales).
 */

export type AppSource = "official-docs" | "official-forum" | "tavily-live" | "seed";

export interface AppCatalogEntry {
  key: string;
  displayName: string;
  version: string;
  officialDomains: string[];
  seedTopics: string[];
}

export const APP_CATALOG: Record<string, AppCatalogEntry> = {
  windows: {
    key: "windows",
    displayName: "Windows 11",
    version: "11",
    officialDomains: ["learn.microsoft.com", "support.microsoft.com"],
    seedTopics: [
      "atajos de teclado en Windows 11",
      "administrador de tareas de Windows",
      "configuración de pantalla y escalado",
      "gestor de ventanas Snap Layouts",
      "atajos de captura de pantalla",
    ],
  },
  excel: {
    key: "excel",
    displayName: "Microsoft Excel",
    version: "365",
    officialDomains: ["support.microsoft.com", "learn.microsoft.com"],
    seedTopics: [
      "formulas y funciones basicas en Excel",
      "tablas dinamicas Excel",
      "buscarv y coincidir en Excel",
      "formato condicional en Excel",
      "atajos de teclado de Excel",
    ],
  },
  word: {
    key: "word",
    displayName: "Microsoft Word",
    version: "365",
    officialDomains: ["support.microsoft.com", "learn.microsoft.com"],
    seedTopics: [
      "estilos y formato en Word",
      "tabla de contenido automatica en Word",
      "control de cambios en Word",
      "combinar correspondencia en Word",
      "atajos de teclado en Word",
    ],
  },
  davinci: {
    key: "davinci",
    displayName: "DaVinci Resolve",
    version: "19",
    officialDomains: ["blackmagicdesign.com", "forum.blackmagicdesign.com"],
    seedTopics: [
      "cortar clip con blade edit mode en DaVinci Resolve",
      "crear keyframes en el Inspector de DaVinci Resolve",
      "editor de nodos en la pagina Color de DaVinci Resolve",
      "activar snapping en el timeline de DaVinci Resolve",
      "exportar video en la pagina Deliver de DaVinci Resolve",
    ],
  },
  premiere: {
    key: "premiere",
    displayName: "Adobe Premiere Pro",
    version: "2025",
    officialDomains: ["helpx.adobe.com", "community.adobe.com"],
    seedTopics: [
      "herramienta razor tool en Premiere Pro",
      "keyframes en Effect Controls de Premiere Pro",
      "exportar con Media Encoder desde Premiere Pro",
      "atajos de teclado de Premiere Pro",
      "corrección de color Lumetri en Premiere Pro",
    ],
  },
  photoshop: {
    key: "photoshop",
    displayName: "Adobe Photoshop",
    version: "2025",
    officialDomains: ["helpx.adobe.com", "community.adobe.com"],
    seedTopics: [
      "herramienta mover y seleccion rapida en Photoshop",
      "capas y mascaras en Photoshop",
      "herramienta de recorte crop tool en Photoshop",
      "generative fill en Photoshop",
      "atajos de teclado de Photoshop",
    ],
  },
  aftereffects: {
    key: "aftereffects",
    displayName: "Adobe After Effects",
    version: "2025",
    officialDomains: ["helpx.adobe.com", "community.adobe.com"],
    seedTopics: [
      "keyframes y curvas en After Effects",
      "capas de forma shape layers en After Effects",
      "composiciones y precomposiciones en After Effects",
      "render queue y exportar en After Effects",
      "atajos de teclado de After Effects",
    ],
  },
  illustrator: {
    key: "illustrator",
    displayName: "Adobe Illustrator",
    version: "2025",
    officialDomains: ["helpx.adobe.com", "community.adobe.com"],
    seedTopics: [
      "herramienta pluma pen tool en Illustrator",
      "pathfinder combinar formas en Illustrator",
      "crear paletas de color y muestras en Illustrator",
      "exportar SVG desde Illustrator",
      "atajos de teclado de Illustrator",
    ],
  },
  blender: {
    key: "blender",
    displayName: "Blender",
    version: "4.2",
    officialDomains: ["docs.blender.org", "blender.org", "blender.stackexchange.com"],
    seedTopics: [
      "alternar entre modo objeto y modo edicion en Blender",
      "transformaciones mover rotar escalar en Blender",
      "extrusion de geometria en Blender",
      "modos de sombreado del viewport en Blender",
      "atajos de teclado de Blender",
    ],
  },
  capcut: {
    key: "capcut",
    displayName: "CapCut Desktop",
    version: "5",
    officialDomains: ["capcut.com", "support.capcut.com"],
    seedTopics: [
      "dividir clip split en CapCut Desktop",
      "keyframes en el panel basico de CapCut",
      "agregar subtitulos automaticos en CapCut",
      "exportar video en CapCut Desktop",
      "atajos de teclado de CapCut",
    ],
  },
  figma: {
    key: "figma",
    displayName: "Figma",
    version: "2026",
    officialDomains: ["help.figma.com", "figma.com", "forum.figma.com"],
    seedTopics: [
      "auto layout en Figma",
      "componentes y variantes en Figma",
      "estilos y variables en Figma",
      "prototipado interactivo en Figma",
      "atajos de teclado de Figma",
    ],
  },
  unity: {
    key: "unity",
    displayName: "Unity",
    version: "6",
    officialDomains: ["docs.unity3d.com", "unity.com", "discussions.unity.com"],
    seedTopics: [
      "editor de escenas y jerarquia en Unity",
      "prefabs y variantes de prefabs en Unity",
      "sistema de scripting con MonoBehaviour en Unity",
      "input system en Unity",
      "build settings y publicar en Unity",
    ],
  },
  unreal: {
    key: "unreal",
    displayName: "Unreal Engine",
    version: "5.4",
    officialDomains: ["docs.unrealengine.com", "unrealengine.com", "forums.unrealengine.com"],
    seedTopics: [
      "editor de niveles y actores en Unreal Engine",
      "blueprints basicos en Unreal Engine",
      "lumen y nanite en Unreal Engine 5",
      "materiales y shaders en Unreal Engine",
      "empaquetar proyecto en Unreal Engine",
    ],
  },
  vscode: {
    key: "vscode",
    displayName: "Visual Studio Code",
    version: "1.94",
    officialDomains: ["code.visualstudio.com", "github.com"],
    seedTopics: [
      "atajos de teclado en Visual Studio Code",
      "paleta de comandos en VS Code",
      "extensiones esenciales de VS Code",
      "depuracion debug en VS Code",
      "control de versiones git en VS Code",
    ],
  },
  notion: {
    key: "notion",
    displayName: "Notion",
    version: "2026",
    officialDomains: ["notion.so", "notion.com", "help.notion.com"],
    seedTopics: [
      "bloques y comandos slash en Notion",
      "bases de datos en Notion",
      "plantillas y automatizaciones en Notion",
      "sincronizacion y colaboracion en Notion",
      "atajos de teclado de Notion",
    ],
  },
};

/** Normaliza cualquier input del usuario a la key canónica del catálogo. */
export function normalizeAppKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

/** Retorna la entrada del catálogo o `undefined` si el app no está registrado. */
export function getAppEntry(input: string): AppCatalogEntry | undefined {
  const key = normalizeAppKey(input);
  if (APP_CATALOG[key]) return APP_CATALOG[key];
  const alias: Record<string, string> = {
    "davinciresolve": "davinci",
    "resolve": "davinci",
    "premierepro": "premiere",
    "adobepremiere": "premiere",
    "adobephotoshop": "photoshop",
    "ps": "photoshop",
    "ai": "illustrator",
    "adobeillustrator": "illustrator",
    "ae": "aftereffects",
    "aftereffect": "aftereffects",
    "adobeaftereffects": "aftereffects",
    "unrealengine": "unreal",
    "ue5": "unreal",
    "unity3d": "unity",
    "vscode": "vscode",
    "visualstudiocode": "vscode",
    "code": "vscode",
    "windows11": "windows",
    "win11": "windows",
    "capcutdesktop": "capcut",
    "microsoftexcel": "excel",
    "microsoftword": "word",
    "msword": "word",
    "msexcel": "excel",
  };
  const aliased = alias[key];
  return aliased ? APP_CATALOG[aliased] : undefined;
}

/** Lista de keys canónicas del catálogo (para iteración en cron y HTTP). */
export function listAppKeys(): string[] {
  return Object.keys(APP_CATALOG);
}


export interface ToolIdentity {
  displayName: string;
  key: string;
  inCatalog: boolean;
  officialDomains?: string[];
}

/** Resuelve un nombre de herramienta a identidad canonica (catalogo o slug dinamico). */
export function resolveToolIdentity(input: string): ToolIdentity {
  const trimmed = input.trim();
  const entry = getAppEntry(trimmed);
  if (entry) {
    return {
      displayName: entry.displayName,
      key: entry.key,
      inCatalog: true,
      officialDomains: entry.officialDomains,
    };
  }
  return {
    displayName: trimmed || "Desconocido",
    key: normalizeAppKey(trimmed || "unknown"),
    inCatalog: false,
  };
}
