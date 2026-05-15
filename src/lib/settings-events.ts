export interface SettingsChangedEvent {
  keys?: string[]
  type: 'settings.changed'
  updatedAt: string
}

type SettingsChangedListener = (event: SettingsChangedEvent) => void

const globalSettingsEvents = globalThis as typeof globalThis & {
  __runPaceFlowSettingsListeners?: Set<SettingsChangedListener>
}

function getListeners() {
  globalSettingsEvents.__runPaceFlowSettingsListeners ??= new Set<SettingsChangedListener>()
  return globalSettingsEvents.__runPaceFlowSettingsListeners
}

export function publishSettingsChanged(keys?: string[]) {
  const event: SettingsChangedEvent = {
    keys,
    type: 'settings.changed',
    updatedAt: new Date().toISOString(),
  }

  for (const listener of getListeners()) {
    listener(event)
  }
}

export function subscribeSettingsChanged(listener: SettingsChangedListener) {
  const listeners = getListeners()
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
