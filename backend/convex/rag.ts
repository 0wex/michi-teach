import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Error al generar embedding (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export const fetchDocsByIds = internalQuery({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, args) => {
    const docs = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) {
        docs.push(doc);
      }
    }
    return docs;
  },
});

export const findByToolTitle = internalQuery({
  args: { tool: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_tool_title", (q) =>
        q.eq("tool", args.tool.toLowerCase()).eq("title", args.title)
      )
      .unique();
  },
});

export const saveDoc = internalMutation({
  args: {
    tool: v.string(),
    title: v.string(),
    content: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("documents", {
      tool: args.tool.toLowerCase(),
      title: args.title,
      content: args.content,
      embedding: args.embedding,
    });
  },
});

export const searchDocs = internalAction({
  args: {
    query: v.string(),
    tool: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<Array<{ title: string; content: string; tool: string; score: number }>> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return [];
    }

    try {
      const queryEmbedding = await generateEmbedding(args.query, apiKey);
      const searchLimit = args.limit ?? 3;
      const targetTool = args.tool?.toLowerCase();

      const searchResults = await ctx.vectorSearch("documents", "by_embedding", {
        vector: queryEmbedding,
        limit: searchLimit,
        filter: targetTool ? (q) => q.eq("tool", targetTool) : undefined,
      });

      if (!searchResults || searchResults.length === 0) {
        return [];
      }

      const docIds = searchResults.map((r) => r._id as Id<"documents">);
      const docs = await ctx.runQuery(internal.rag.fetchDocsByIds, { ids: docIds });

      return docs.map((doc, idx) => ({
        title: doc.title,
        content: doc.content,
        tool: doc.tool,
        score: searchResults[idx]?._score ?? 0,
      }));
    } catch (err) {
      console.error("Error en RAG searchDocs:", err);
      return [];
    }
  },
});

export const seedDocs = internalAction({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; insertedCount: number; skippedCount: number }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("No hay OPENAI_API_KEY configurada para generar embeddings");
    }

    const initialDocs = [
      {
        tool: "davinci",
        title: "Herramienta de Cuchilla (Blade Edit Mode)",
        content:
          "En DaVinci Resolve (página Edit y Cut), la herramienta Cuchilla (Blade Edit Mode) permite dividir o cortar clips en el cabezal de reproducción. Su atajo oficial de teclado es 'B'. Para volver a la flecha de selección normal se presiona la tecla 'A'. El botón se encuentra en la barra de herramientas central encima de la línea de tiempo.",
      },
      {
        tool: "davinci",
        title: "Keyframes e Inspector de Transformación",
        content:
          "Para crear o animar keyframes en DaVinci Resolve, selecciona el clip y abre el panel Inspector en la esquina superior derecha. Junto a cada parámetro de transformación (Zoom X/Y, Position, Rotation) hay un pequeño ícono de rombo o diamante. Al hacer clic sobre el rombo, este se ilumina en color rojo o naranja, indicando que se ha fijado un fotograma clave (keyframe) en la posición actual del cabezal.",
      },
      {
        tool: "davinci",
        title: "Página Color y Creación de Nodos",
        content:
          "En la página Color de DaVinci Resolve, el flujo de trabajo se basa en el Editor de Nodos (Node Graph) en la parte superior derecha. Para añadir un nuevo nodo serial de corrección, el atajo de teclado es 'Alt + S' (Option + S en macOS). Para crear un nodo paralelo es 'Alt + P'. Las conexiones verdes representan canales RGB/Video y las azules canales de máscara/key.",
      },
      {
        tool: "davinci",
        title: "Imán y Ajuste Magnético (Snapping)",
        content:
          "El ajuste magnético (Snapping) en la línea de tiempo de DaVinci Resolve permite que los cortes y cabezales se alineen exactamente con los bordes de los clips. Se activa y desactiva con el atajo de teclado 'N'. Su ícono es una herradura de imán ubicada en la barra de herramientas central.",
      },
      {
        tool: "blender",
        title: "Alternar entre Modo Objeto y Modo Edición",
        content:
          "En Blender 3D, para alternar entre el Modo Objeto (Object Mode) y el Modo Edición (Edit Mode) se utiliza la tecla 'TAB'. En Modo Edición puedes modificar vértices (tecla 1), aristas (tecla 2) y caras (tecla 3) de la malla seleccionada.",
      },
      {
        tool: "blender",
        title: "Transformaciones Básicas: Mover, Rotar y Escalar",
        content:
          "Las transformaciones fundamentales en Blender se ejecutan con atajos rápidos de una tecla: 'G' para Grab/Mover (traslación), 'R' para Rotar, y 'S' para Escalar. Para restringir la transformación a un eje específico, presiona inmediatamente 'X', 'Y' o 'Z'.",
      },
      {
        tool: "blender",
        title: "Extrusión de Geometría",
        content:
          "En Modo Edición de Blender, para extruir una cara, borde o vértice seleccionado se presiona la tecla 'E'. El cursor permitirá jalar la nueva geometría a lo largo de la normal.",
      },
      {
        tool: "blender",
        title: "Modos de Vista de Sombreado (Viewport Shading)",
        content:
          "Para cambiar entre los modos de visualización de sombreado (Wireframe, Solid, Material Preview, Rendered), presiona la tecla 'Z' para abrir el menú circular de sombreado, o haz clic en las 4 esferas ubicadas en la esquina superior derecha del Viewport 3D.",
      },
      {
        tool: "capcut",
        title: "Dividir Clip (Split Tool)",
        content:
          "En CapCut Desktop, para dividir un clip en la línea de tiempo en la posición actual del cabezal, presiona la tecla 'B' o el atajo 'Ctrl + B' ('Cmd + B' en macOS). El ícono de división (Split) está situado en la barra de herramientas superior izquierda del timeline.",
      },
      {
        tool: "capcut",
        title: "Keyframes en Panel Básico",
        content:
          "En CapCut Desktop, para añadir un keyframe a un clip, selecciónalo en el timeline y dirígete al panel derecho en la pestaña 'Video' -> 'Basic'. Haz clic en el ícono de rombo/diamante situado al lado de 'Scale' (Escala) o 'Position' (Posición). El rombo cambiará a color azul/verde indicando que el keyframe está activo.",
      },
      {
        tool: "photoshop",
        title: "Herramienta de Selección Rápida y Mover",
        content:
          "En Adobe Photoshop, la herramienta de Mover (Move Tool) se activa con la tecla 'V' y se encuentra en la parte superior de la barra de herramientas vertical izquierda. Para la herramienta de Selección Rápida o Varita Mágica, el atajo de teclado es 'W'.",
      },
      {
        tool: "photoshop",
        title: "Herramienta de Recorte (Crop Tool)",
        content:
          "Para recortar o cambiar el lienzo en Adobe Photoshop, el atajo de teclado es 'C'. Aparecerá un marco de ajuste sobre el lienzo que puedes redimensionar antes de presionar 'Enter' para confirmar el recorte.",
      },
      {
        tool: "premiere",
        title: "Herramienta Cuchilla (Razor Tool)",
        content:
          "En Adobe Premiere Pro, la herramienta de corte se denomina Cuchilla (Razor Tool) y su atajo de teclado es la tecla 'C'. Para regresar a la herramienta de selección normal presiona 'V'. Se ubica en la barra vertical de herramientas flotante del timeline.",
      },
    ];

    let insertedCount = 0;
    let skippedCount = 0;

    for (const doc of initialDocs) {
      const existing = await ctx.runQuery(internal.rag.findByToolTitle, {
        tool: doc.tool,
        title: doc.title,
      });
      if (existing) {
        skippedCount++;
        continue;
      }

      const embedding = await generateEmbedding(`${doc.title}. ${doc.content}`, apiKey);
      await ctx.runMutation(internal.rag.saveDoc, {
        tool: doc.tool,
        title: doc.title,
        content: doc.content,
        embedding,
      });
      insertedCount++;
    }

    return { success: true, insertedCount, skippedCount };
  },
});
