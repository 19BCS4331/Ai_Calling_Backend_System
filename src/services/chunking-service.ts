/**
 * Chunking Service
 * 
 * Splits text content into overlapping chunks for embedding and retrieval.
 * Uses recursive character splitting with a hierarchy of separators.
 * 
 * Optimal settings for RAG:
 * - Chunk size: ~512 tokens (~2000 chars)
 * - Overlap: ~50 tokens (~200 chars)
 * - Separators: paragraphs → lines → sentences → words
 */

export interface ChunkOptions {
  chunkSize?: number;       // Target chunk size in characters (default 2000)
  chunkOverlap?: number;    // Overlap between chunks in characters (default 200)
  minChunkSize?: number;    // Minimum chunk size to keep (default 100)
}

export interface Chunk {
  content: string;
  index: number;
  metadata: {
    startChar: number;
    endChar: number;
    tokenEstimate: number;
  };
}

const DEFAULT_SEPARATORS = [
  '\n\n\n',   // Triple newline (major sections)
  '\n\n',     // Double newline (paragraphs)
  '\n',       // Single newline (lines)
  '। ',       // Hindi sentence end (purna viram)
  '. ',       // English sentence end
  '? ',       // Question
  '! ',       // Exclamation
  '; ',       // Semicolon
  ', ',       // Comma
  ' ',        // Word boundary
];

/**
 * Split text into overlapping chunks using recursive character splitting.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const {
    chunkSize = 2000,
    chunkOverlap = 200,
    minChunkSize = 100,
  } = options;

  if (!text || text.trim().length < minChunkSize) {
    if (text && text.trim().length > 0) {
      return [{
        content: text.trim(),
        index: 0,
        metadata: {
          startChar: 0,
          endChar: text.length,
          tokenEstimate: estimateTokens(text.trim()),
        },
      }];
    }
    return [];
  }

  const rawChunks = recursiveSplit(text, DEFAULT_SEPARATORS, chunkSize);
  
  // Merge small chunks and apply overlap
  const chunks: Chunk[] = [];
  let charOffset = 0;

  for (let i = 0; i < rawChunks.length; i++) {
    let content = rawChunks[i].trim();
    if (content.length < minChunkSize && i < rawChunks.length - 1) {
      // Merge with next chunk
      rawChunks[i + 1] = content + '\n' + rawChunks[i + 1];
      charOffset += rawChunks[i].length;
      continue;
    }

    if (content.length === 0) {
      charOffset += rawChunks[i].length;
      continue;
    }

    // Add overlap from previous chunk
    if (chunks.length > 0 && chunkOverlap > 0) {
      const prevContent = chunks[chunks.length - 1].content;
      const overlapText = prevContent.slice(-chunkOverlap);
      // Only prepend overlap if it doesn't make the chunk too large
      if (overlapText.length + content.length <= chunkSize * 1.2) {
        content = overlapText + content;
      }
    }

    chunks.push({
      content,
      index: chunks.length,
      metadata: {
        startChar: charOffset,
        endChar: charOffset + rawChunks[i].length,
        tokenEstimate: estimateTokens(content),
      },
    });

    charOffset += rawChunks[i].length;
  }

  return chunks;
}

/**
 * Recursively split text using a hierarchy of separators.
 */
function recursiveSplit(text: string, separators: string[], targetSize: number): string[] {
  if (text.length <= targetSize) {
    return [text];
  }

  // Find the first separator that exists in the text
  for (const sep of separators) {
    if (text.includes(sep)) {
      const parts = text.split(sep);
      const result: string[] = [];
      let current = '';

      for (const part of parts) {
        const candidate = current ? current + sep + part : part;
        
        if (candidate.length > targetSize && current.length > 0) {
          result.push(current);
          current = part;
        } else {
          current = candidate;
        }
      }

      if (current.length > 0) {
        result.push(current);
      }

      // Recursively split any chunks that are still too large
      const finalResult: string[] = [];
      for (const chunk of result) {
        if (chunk.length > targetSize) {
          const remainingSeps = separators.slice(separators.indexOf(sep) + 1);
          if (remainingSeps.length > 0) {
            finalResult.push(...recursiveSplit(chunk, remainingSeps, targetSize));
          } else {
            // Hard split at targetSize as last resort
            for (let i = 0; i < chunk.length; i += targetSize) {
              finalResult.push(chunk.slice(i, i + targetSize));
            }
          }
        } else {
          finalResult.push(chunk);
        }
      }

      return finalResult;
    }
  }

  // No separator found — hard split
  const result: string[] = [];
  for (let i = 0; i < text.length; i += targetSize) {
    result.push(text.slice(i, i + targetSize));
  }
  return result;
}

/**
 * Rough token estimate: ~4 chars per token for English, ~2-3 for Hindi/Devanagari.
 */
export function estimateTokens(text: string): number {
  // Check if text has Indic characters
  const indicChars = (text.match(/[\u0900-\u0DFF]/g) || []).length;
  const totalChars = text.length;
  
  if (indicChars > totalChars * 0.3) {
    // Predominantly Indic text — ~2.5 chars per token
    return Math.ceil(totalChars / 2.5);
  }
  
  // Predominantly Latin/English — ~4 chars per token
  return Math.ceil(totalChars / 4);
}
