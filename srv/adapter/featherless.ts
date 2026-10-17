import { config } from '../config'
import { wait } from '../db/util'
import { logger } from '../middleware'

type V1Model = {
  id: string
  name: string
  owned_by: string
  updated_at: string
  model_class: string
  context_length: number
  max_completion_tokens: number
  available_on_current_plan: boolean
}

export type FeatherlessModel = {
  id: string
  name: string
  model_class: string
  status: 'active' | 'not_deployed' | 'pending_deploy'
  health?: 'OFFLINE' | 'UNHEALTHY' | 'HEALTHY'

  ctx: number
  res: number
  plan: boolean

  created?: string
}

let modelCache: FeatherlessModel[] = []
let classCache: Record<string, { ctx: number; res: number }> = {}

export function getFeatherModels() {
  return { models: modelCache, classes: classCache }
}

async function getModelList() {
  if (config.inference.skipModelLists) return []

  const url = 'https://api.featherless.ai/v1/models?available_on_current_plan=true'
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:58.0) Gecko/20100101 Firefox/58.0',
      },
      method: 'GET',
    }).then((res) => res.json())

    const models = res?.data as V1Model[]
    if (!models) return

    const all: FeatherlessModel[] = []

    for (const model of models) {
      all.push({
        id: model.id,
        model_class: model.model_class,
        ctx: model.context_length,
        name: model.name,
        res: model.max_completion_tokens,
        status: 'active',
        created: model.updated_at,
        plan: model.available_on_current_plan,
      })

      if (!model.model_class) continue
      if (classCache[model.model_class]) continue

      classCache[model.model_class] = {
        ctx: model.context_length,
        res: model.max_completion_tokens,
      }
    }

    modelCache = all
  } catch (ex) {
    logger.warn({ err: ex }, `Featherless model list failed`)
  } finally {
    await wait(60000 * 10)
    getModelList()
  }
}

async function getModelClasses() {
  let page = 1
  const all: any[] = []

  while (true) {
    try {
      const res = await fetch(`https://featherless.ai/api/feather/models?page=${page}&perPage=50`, {
        headers: {
          accept: '*/*',
        },
        method: 'GET',
      })

      if (res.status === 404) {
        break
      }

      if (res.status > 200) {
        const text = await res.text().catch(() => 'Could not parse')
        logger.warn(
          { warning: text, page },
          `Featherless model classes failed: ${res.status} ${res.statusText}`
        )

        await wait(3000)
        continue
      }

      const json = await res.json()
      const items = json?.items

      if (items.length) {
        all.push(...items)
      }

      if (items.length < 50) break
      await wait(4000)
      page++
    } catch (ex: any) {
      logger.warn(`Featherless model classes failed: ${ex.message || ex}`)
      return
    }
  }

  return all
}

getModelList()
