import api from './api'

export interface ProjectAddress {
  line1: string
  line2?: string
  city: string
  state: string
  pincode: string
}

export interface FloorPlan {
  plan_id: string
  label: string
  file_url: string
  file_type: 'pdf' | 'image'
  uploaded_by: string
  uploaded_at: string
}

export interface BHKConfig {
  bhk_type: string
  floor_plans: FloorPlan[]
}

export interface Project {
  id: string
  project_id: string
  name: string
  address: ProjectAddress
  bhk_configs: BHKConfig[]
  status: 'active' | 'inactive' | 'archived'

  // People & timeline
  lead?: string
  client_name?: string
  client_phone?: string
  started_at?: string
  target_at?: string

  // Physical
  units: number
  floors: number

  // Financial (values in Crores)
  budget: number
  spent: number
  progress: number   // 0.0 – 1.0

  created_by: string
  created_at: string
  updated_at: string
}

export interface ProjectListResult {
  projects: Project[]
  total: number
  page: number
  limit: number
}

export interface CreateProjectPayload {
  name: string
  address: ProjectAddress
  bhk_configs?: BHKConfig[]
  lead?: string
  client_name?: string
  client_phone?: string
  started_at?: string
  target_at?: string
  units?: number
  floors?: number
  budget?: number
  spent?: number
  progress?: number
}

export interface UpdateProjectPayload {
  name?: string
  address?: ProjectAddress
  lead?: string
  client_name?: string
  client_phone?: string
  started_at?: string
  target_at?: string
  units?: number
  floors?: number
  budget?: number
  spent?: number
  progress?: number
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const listProjects = (params?: {
  status?: string
  city?: string
  include_archived?: boolean
  page?: number
  limit?: number
}) => api.get<{ success: boolean; data: ProjectListResult }>('/projects', { params })

export const getProject = (projectId: string) =>
  api.get<{ success: boolean; data: Project }>(`/projects/${projectId}`)

export const createProject = (payload: CreateProjectPayload) =>
  api.post<{ success: boolean; data: Project }>('/projects', payload)

export const updateProject = (projectId: string, payload: UpdateProjectPayload) =>
  api.put<{ success: boolean; data: Project }>(`/projects/${projectId}`, payload)

export const archiveProject = (projectId: string) =>
  api.delete<{ success: boolean; data: { archived: boolean } }>(`/projects/${projectId}`)

export const restoreProject = (projectId: string) =>
  api.post<{ success: boolean; data: { restored: boolean } }>(`/projects/${projectId}/restore`)

export const getUploadUrl = (
  projectId: string,
  bhkType: string,
  filename: string,
  contentType: string,
) =>
  api.post<{ success: boolean; data: { upload_url: string; public_url: string } }>(
    `/projects/${projectId}/floor-plans/${bhkType}/upload-url`,
    { filename, content_type: contentType },
  )

export const addFloorPlan = (
  projectId: string,
  bhkType: string,
  payload: { label: string; file_url: string; file_type: 'pdf' | 'image' },
) =>
  api.post<{ success: boolean; data: Project }>(
    `/projects/${projectId}/floor-plans/${bhkType}`,
    payload,
  )

export const removeFloorPlan = (projectId: string, bhkType: string, planId: string) =>
  api.delete<{ success: boolean; data: Project }>(
    `/projects/${projectId}/floor-plans/${bhkType}/${planId}`,
  )
