import {
  AutomationExecutionState,
  AutomationSettings,
  AutomationState,
  AutomationTrigger,
  AutomationType,
} from '../../../types/automationTypes'

export interface DbAutomationInsertData {
  type: AutomationType
  trigger: AutomationTrigger
  settings: AutomationSettings
  state: AutomationState
}

export interface DbAutomationUpdateData {
  trigger: AutomationTrigger
  settings: AutomationSettings
  state: AutomationState
}

export interface DbAutomationExecutionInsertData {
  automationId: string
  type: AutomationType
  tenantId: string
  trigger: AutomationTrigger
  state: AutomationExecutionState
  error: any | null
  executedAt: Date
  eventId: string
  payload: any
}
