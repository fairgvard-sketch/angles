import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Deliberately checks file destinations, not Markdown anchors or external URLs.
export function localLinks(markdown) {
  const prose = markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
  return [...prose.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)]
    .map((match) => match[1] || match[2])
    .filter((href) => !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href))
    .map((href) => decodeURIComponent(href.split(/[?#]/)[0]))
    .filter(Boolean)
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : []
  })
}

function within(file, directory) {
  const path = relative(directory, file)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
}

export function checkDocs({ root, requireKassa = false }) {
  root = resolve(root)
  const kassa = resolve(root, '../kassa')
  const hasKassa = existsSync(kassa)
  const errors = []
  if (requireKassa && !hasKassa) errors.push('Required sibling kassa repository is missing')
  // These are the curated working docs; historic internals are intentionally excluded.
  const siteFiles = [
    'README.md', 'docs/README.md', 'docs/system-overview.md', 'docs/development.md',
    'docs/release-checklist.md', 'docs/documentation-policy.md', 'docs/account-access.md',
    'docs/verification-log.md', 'docs/product-completion-plan.md', 'docs/archive/README.md',
  ].map((file) => join(root, file))
  const kassaFiles = hasKassa ? ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/billing.md',
    'docs/backups.md', 'docs/development.md'].map((file) => join(kassa, file)) : []
  const indexFiles = new Set([
    join(root, 'docs/README.md'), join(root, 'docs/archive/README.md'), join(kassa, 'docs/README.md'),
  ])
  const indexed = new Set(indexFiles)
  let checked = 0
  let skipped = 0
  for (const file of [...siteFiles, ...kassaFiles]) {
    if (!existsSync(file)) {
      errors.push(`Missing working document: ${relative(root, file)}`)
      continue
    }
    for (const href of localLinks(readFileSync(file, 'utf8'))) {
      const target = resolve(dirname(file), href)
      if (indexFiles.has(file)) indexed.add(target)
      if (!hasKassa && within(target, kassa)) {
        skipped++
        continue
      }
      checked++
      if (!existsSync(target)) errors.push(`${relative(root, file)} → missing ${href}`)
    }
  }
  const documents = [...markdownFiles(join(root, 'docs')), ...(hasKassa ? markdownFiles(join(kassa, 'docs')) : [])]
  for (const file of documents) {
    if (!indexed.has(file)) errors.push(`Not classified in documentation index: ${relative(root, file)}`)
  }
  return { errors, checked, skipped, documents: documents.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--require-kassa')) {
    console.error('Usage: node scripts/check-docs.mjs [--require-kassa]')
    process.exitCode = 1
  } else {
    const result = checkDocs({ root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), requireKassa: args.includes('--require-kassa') })
    for (const error of result.errors) console.error(error)
    console.log(`Docs: ${result.documents} indexed documents checked; ${result.checked} local links; ${result.skipped} sibling links skipped; ${result.errors.length} errors.`)
    if (result.skipped) console.log('Kassa documentation is absent. Use --require-kassa for a mandatory two-repository check.')
    process.exitCode = result.errors.length ? 1 : 0
  }
}
