import fs from 'node:fs/promises';
import path from 'node:path';

const projectEnv = (
  process.env.FOUNDRY_RPG_PROJECT ||
  process.env.AZURE_OPENAI_ENDPOINT ||
  ''
).trim();
const apiKey = (
  process.env.FOUNDRY_KEY ||
  process.env.AZURE_OPENAI_API_KEY ||
  ''
).trim();

if (!projectEnv) {
  console.error('Missing FOUNDRY_RPG_PROJECT or AZURE_OPENAI_ENDPOINT in environment');
  process.exit(1);
}

const outDir = path.resolve('public/assets');
await fs.mkdir(outDir, { recursive: true });

/**
 * Resolves candidate Azure Foundry / Azure OpenAI image generation endpoints
 * from FOUNDRY_RPG_PROJECT without logging any sensitive URL or key.
 */
function buildCandidateEndpoints(baseStr) {
  const clean = baseStr.replace(/\/+$/, '');
  const candidates = [];

  if (clean.includes('/images/generations')) {
    candidates.push(clean);
  }

  // Extract origin if URL
  try {
    const u = new URL(clean);
    const origin = u.origin;
    const deployments = ['gpt-image-2.5-sunburst', 'gpt-image-1.5', 'gpt-image-1', 'dall-e-3'];
    for (const dep of deployments) {
      candidates.push(`${origin}/openai/deployments/${dep}/images/generations?api-version=2025-04-01-preview`);
      candidates.push(`${origin}/openai/deployments/${dep}/images/generations?api-version=2024-05-01-preview`);
      candidates.push(`${clean}/openai/deployments/${dep}/images/generations?api-version=2025-04-01-preview`);
    }
    candidates.push(`${origin}/openai/v1/images/generations`);
    candidates.push(`${clean}/images/generations?api-version=2025-04-01-preview`);
  } catch {
    // Not a full URL
  }
  return [...new Set(candidates)];
}

async function generateImage(prompt, filename) {
  const endpoints = buildCandidateEndpoints(projectEnv);

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          model: 'gpt-image-2.5-sunburst',
          n: 1,
          size: '1024x1024',
        }),
      });

      if (!res.ok) {
        continue;
      }

      const data = await res.json();
      const item = data?.data?.[0];
      if (item?.b64_json) {
        const buf = Buffer.from(item.b64_json, 'base64');
        await fs.writeFile(path.join(outDir, filename), buf);
        console.log(`[assets] Generated ${filename} (${buf.length} bytes)`);
        return true;
      } else if (item?.url) {
        const imgRes = await fetch(item.url);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          await fs.writeFile(path.join(outDir, filename), buf);
          console.log(`[assets] Downloaded ${filename} (${buf.length} bytes)`);
          return true;
        }
      }
    } catch {
      // Try next endpoint candidate
    }
  }
  return false;
}

const assets = [
  {
    filename: 'tubify-logo.png',
    prompt:
      'Minimalist luxury app icon for a hi-fi music controller named Tubify. A glowing warm sunburst vinyl record fused with analog vacuum tube filaments, deep obsidian glass background, warm amber gold and sunset coral neon accents, sleek modern vector icon, no text, centered.',
  },
  {
    filename: 'vinyl-placeholder.png',
    prompt:
      'High-end audiophile turntable platter top-down view, glowing warm amber vacuum-tube light reflections on deep matte black vinyl grooves, sunset gold and magenta studio rim lighting, sleek minimal square album cover art, no text.',
  },
  {
    filename: 'empty-crate.png',
    prompt:
      'Stylized isometric illustration of a glowing warm amber glass vinyl record crate and studio headphones on a dark obsidian desk, cozy hi-fi listening room aesthetic, sunset coral and gold accents, no text.',
  },
];

let successCount = 0;
for (const asset of assets) {
  const ok = await generateImage(asset.prompt, asset.filename);
  if (ok) successCount++;
}

console.log(`[assets] Completed: ${successCount}/${assets.length} generated via Foundry.`);
