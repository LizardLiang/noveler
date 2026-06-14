import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  type ElectronApplication,
  type Page,
  type JSHandle,
  expect,
  test,
  _electron as electron,
} from '@playwright/test'
import type { BrowserWindow } from 'electron'

const root = path.resolve(import.meta.dirname, '..', '..')
let electronApp: ElectronApplication
let page: Page
const consoleLogs: string[] = []
const mainProcessLogs: string[] = []

test.beforeAll(async () => {
  test.setTimeout(60000)

  electronApp = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
  })
  page = await electronApp.firstWindow()

  // Capture renderer console logs
  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('[HADES-DEBUG]')) {
      consoleLogs.push(text)
      console.log('RENDERER:', text)
    }
  })

  // Wait for app to fully load
  await page.waitForSelector('#root > *', { timeout: 15000 })
})

test.afterAll(async () => {
  console.log('\n========== HADES DEBUG LOGS (RENDERER) ==========')
  for (const log of consoleLogs) {
    console.log(log)
  }
  console.log('=================================================\n')

  if (page) {
    await page.screenshot({ path: 'test/screenshots/hades-debug.png' })
    await page.close()
  }
  if (electronApp) {
    await electronApp.close()
  }
})

test.describe('[HADES] Bug reproduction', () => {
  test('Bug 2: StreamingTextRenderer — verify rendering mode', async () => {
    // Inject test: verify StreamingTextRenderer exists and check its behavior
    // We'll evaluate the component's rendering logic directly
    const result = await page.evaluate(() => {
      // Check if ReactMarkdown is used during streaming
      // We can't directly test the component, but we can check the DOM
      // Create a test scenario by examining the component source
      return {
        hasReactMarkdown: typeof (window as unknown as Record<string, unknown>).ReactMarkdown !== 'undefined',
        appLoaded: document.querySelector('#root')?.innerHTML?.length ?? 0,
      }
    })
    console.log('[HADES-DEBUG] App state:', result)
    expect(result.appLoaded).toBeGreaterThan(0)
  })

  test('Bug 1: acceptSuggestion — inject and accept a world change', async () => {
    // First check if there are any projects — we need one to test
    const hasProject = await page.evaluate(async () => {
      try {
        const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('project:list') as { success: boolean; data: { id: string; name: string; storagePath: string }[] }
        return { success: result.success, count: result.data?.length ?? 0, projects: result.data }
      } catch (e) {
        return { success: false, count: 0, error: String(e) }
      }
    })
    console.log('[HADES-DEBUG] Projects:', JSON.stringify(hasProject))

    if (!hasProject.success || hasProject.count === 0) {
      console.log('[HADES-DEBUG] No projects found — creating a test project')
      // Create a project to test with
      const createResult = await page.evaluate(async () => {
        try {
          const tmpPath = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('settings:get') as { success: boolean; data: { defaultStoragePath: string } }
          const storagePath = tmpPath.success ? tmpPath.data.defaultStoragePath : 'C:\\Users\\shotu\\AppData\\Local\\Noveler\\projects'
          const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('project:create', {
            name: 'hades-test',
            description: 'debug test project',
            storagePath,
          })
          return result as { success: boolean; data: { id: string; storagePath: string } }
        } catch (e) {
          return { success: false, error: String(e) }
        }
      })
      console.log('[HADES-DEBUG] Create project result:', JSON.stringify(createResult))
    }

    // Get the project to use
    const projects = await page.evaluate(async () => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('project:list') as { success: boolean; data: { id: string; name: string; storagePath: string }[] }
      return result.success ? result.data : []
    }) as { id: string; name: string; storagePath: string }[]

    if (projects.length === 0) {
      console.log('[HADES-DEBUG] Still no projects — cannot proceed')
      return
    }

    const projectId = projects[0].id
    const storagePath = projects[0].storagePath
    console.log('[HADES-DEBUG] Using project:', projectId)

    // Open the project
    const openResult = await page.evaluate(async (sp: string) => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('project:open', sp) as { success: boolean; data?: unknown; error?: unknown }
      return result
    }, storagePath)
    console.log('[HADES-DEBUG] Open project result:', JSON.stringify(openResult))

    // Get branch tree to find branchId
    const branchResult = await page.evaluate(async (pid: string) => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('branch:getTree', pid) as { success: boolean; data: { branch: { id: string; isMain: boolean } }[] }
      return result
    }, projectId)
    console.log('[HADES-DEBUG] Branch tree:', JSON.stringify(branchResult))

    const branchId = (branchResult as { success: boolean; data: { branch: { id: string; isMain: boolean } }[] }).success
      ? (branchResult as { data: { branch: { id: string } }[] }).data?.[0]?.branch?.id ?? ''
      : ''

    if (!branchId) {
      console.log('[HADES-DEBUG] No branch found — cannot proceed')
      return
    }

    // TEST 1: Accept a new_character — should succeed
    console.log('\n[HADES-DEBUG] ===== TEST: accept new_character =====')
    const acceptCharResult = await page.evaluate(async (args: { pid: string; bid: string }) => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke(
        'worldMemory:acceptDetection',
        args.pid,
        args.bid,
        { type: 'new_character', data: { name: '蘇辰', appearance: '黑髮劍客', personality: '冷酷' } },
      ) as { success: boolean; error?: unknown }
      return result
    }, { pid: projectId, bid: branchId })
    console.log('[HADES-DEBUG] Accept new_character result:', JSON.stringify(acceptCharResult))

    // Verify character was created
    const charsAfter = await page.evaluate(async (pid: string) => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('worldMemory:getCharacters', pid) as { success: boolean; data: { name: string }[] }
      return result
    }, projectId)
    console.log('[HADES-DEBUG] Characters after accept:', JSON.stringify(charsAfter))

    // TEST 2: Accept a new_relationship for characters that DON'T EXIST — should fail silently
    console.log('\n[HADES-DEBUG] ===== TEST: accept new_relationship (characters NOT in DB) =====')
    const acceptRelResult = await page.evaluate(async (args: { pid: string; bid: string }) => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke(
        'worldMemory:acceptDetection',
        args.pid,
        args.bid,
        { type: 'new_relationship', data: { characterA: '蘇辰', characterB: '林雪兒', type: '對手', affinityChange: -20 } },
      ) as { success: boolean; error?: unknown }
      return result
    }, { pid: projectId, bid: branchId })
    console.log('[HADES-DEBUG] Accept new_relationship result:', JSON.stringify(acceptRelResult))

    // Verify relationship was NOT created (林雪兒 doesn't exist)
    const relsAfter = await page.evaluate(async (args: { pid: string; bid: string }) => {
      const result = await (window as unknown as Record<string, { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }>).ipcRenderer.invoke('worldMemory:getRelationships', args.pid, args.bid) as { success: boolean; data: unknown[] }
      return result
    }, { pid: projectId, bid: branchId })
    console.log('[HADES-DEBUG] Relationships after accept:', JSON.stringify(relsAfter))

    // THE BUG: acceptRelResult.success === true, but relationships is empty
    // Handler returned success even though nothing was written
    expect(acceptRelResult).toHaveProperty('success', true)  // handler says success
    const relData = (relsAfter as { data: unknown[] }).data ?? []
    console.log('[HADES-DEBUG] BUG PROOF: handler returned success=' + (acceptRelResult as { success: boolean }).success + ' but relationship count=' + relData.length)
    // This proves the silent failure: success:true but 0 relationships created
  })
})
