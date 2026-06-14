import path from 'node:path'
import {
  type ElectronApplication,
  type Page,
  expect,
  test,
  _electron as electron,
} from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..', '..')
let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  test.setTimeout(60000)
  electronApp = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
  })
  page = await electronApp.firstWindow()

  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('[HADES]')) console.log('RENDERER:', text)
  })

  await page.waitForSelector('#root > *', { timeout: 15000 })
})

test.afterAll(async () => {
  if (page) {
    await page.screenshot({ path: 'test/screenshots/hades-click-final.png' })
    await page.close()
  }
  if (electronApp) await electronApp.close()
})

test('Bug 1: 全部接受 button click test', async () => {
  // Navigate to the project story page
  const projects = await page.evaluate(async () => {
    const r = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('project:list') as { success: boolean; data: { id: string; storagePath: string }[] }
    return r.success ? r.data : []
  }) as { id: string; storagePath: string }[]

  if (projects.length === 0) {
    console.log('[HADES] No projects, skipping')
    return
  }

  const projectId = projects[0].id

  // Open the project DB on the main process side
  await page.evaluate(async (sp: string) => {
    await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('project:open', sp)
  }, projects[0].storagePath)

  // Navigate to story page
  await page.evaluate((pid: string) => {
    window.location.hash = `#/story/${pid}`
  }, projectId)

  // Wait for story page to load
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'test/screenshots/hades-click-story.png' })

  // Check what paragraphs exist
  const paraInfo = await page.evaluate(() => {
    const blocks = document.querySelectorAll('[id^="paragraph-"]')
    return {
      count: blocks.length,
      ids: Array.from(blocks).map(b => b.id),
    }
  })
  console.log('[HADES] Paragraphs on page:', JSON.stringify(paraInfo))

  if (paraInfo.count === 0) {
    console.log('[HADES] No paragraphs visible, skipping')
    return
  }

  // Inject world change suggestions into the Zustand store
  // Find the last AI paragraph ID
  const lastAiParaId = await page.evaluate(() => {
    const blocks = document.querySelectorAll('[id^="paragraph-"]')
    const ids = Array.from(blocks).map(b => b.id.replace('paragraph-', ''))
    return ids[ids.length - 1] || ''
  })
  console.log('[HADES] Targeting paragraph:', lastAiParaId)

  // Inject suggestions via the store
  const injected = await page.evaluate((paraId: string) => {
    // Access Zustand store via React internals
    // The store is a module-level singleton, we need to reach it through the component tree
    // Alternative: we can dispatch through the window

    // Simpler approach: find the store via __ZUSTAND__
    // Actually, Zustand stores don't expose themselves globally.
    // Let's use a different approach: directly call the IPC to see if buttons work

    // We can test click behavior by injecting a test element
    const paragraphDiv = document.getElementById(`paragraph-${paraId}`)
    if (!paragraphDiv) return { error: 'paragraph not found' }

    // Check existing suggestion bar
    const existingSuggestion = paragraphDiv.querySelector('[style*="border-top"]')

    return {
      paragraphFound: true,
      hasSuggestionBar: !!existingSuggestion,
      paragraphHTML: paragraphDiv.innerHTML.slice(0, 500),
    }
  }, lastAiParaId)
  console.log('[HADES] Injection target:', JSON.stringify(injected))

  // Since we can't easily inject Zustand state from Playwright,
  // let's test the actual click path more directly.
  // Check if the suggestion bar ever appears and if so, try to click it.

  // First, check if there's already a suggestion bar visible on ANY paragraph
  const suggestionBars = await page.evaluate(() => {
    // Look for the suggestion title text
    const allElements = document.querySelectorAll('span')
    const suggestions: { text: string; parentHTML: string }[] = []
    for (const el of allElements) {
      if (el.textContent?.includes('偵測到世界變更') || el.textContent?.includes('世界線變更')) {
        suggestions.push({
          text: el.textContent,
          parentHTML: el.parentElement?.outerHTML?.slice(0, 300) ?? '',
        })
      }
    }

    // Also look for 全部接受 button
    const buttons = document.querySelectorAll('button')
    const acceptButtons: { text: string; disabled: boolean; rect: { x: number; y: number; w: number; h: number }; zIndex: string; pointerEvents: string; visible: boolean }[] = []
    for (const btn of buttons) {
      if (btn.textContent?.includes('全部接受')) {
        const rect = btn.getBoundingClientRect()
        const computed = window.getComputedStyle(btn)
        acceptButtons.push({
          text: btn.textContent,
          disabled: btn.disabled,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          zIndex: computed.zIndex,
          pointerEvents: computed.pointerEvents,
          visible: rect.width > 0 && rect.height > 0,
        })
      }
    }

    return { suggestions, acceptButtons }
  })
  console.log('[HADES] Suggestion bars found:', JSON.stringify(suggestionBars))

  // Now check what element is at the position of the 全部接受 button
  if (suggestionBars.acceptButtons.length > 0) {
    const btn = suggestionBars.acceptButtons[0]
    const elementAtPoint = await page.evaluate((pos: { x: number; y: number }) => {
      const el = document.elementFromPoint(pos.x, pos.y)
      if (!el) return { tag: 'null', text: '', id: '' }
      return {
        tag: el.tagName,
        text: el.textContent?.slice(0, 100) ?? '',
        id: el.id,
        className: el.className,
        outerHTML: el.outerHTML?.slice(0, 300) ?? '',
      }
    }, { x: btn.rect.x + btn.rect.w / 2, y: btn.rect.y + btn.rect.h / 2 })
    console.log('[HADES] Element at button position:', JSON.stringify(elementAtPoint))
  }
})
