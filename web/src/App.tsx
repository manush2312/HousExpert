import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import AppLayout from './layouts/AppLayout'
import RequireAuth from './components/RequireAuth'
import RequireRole from './components/RequireRole'
import LoginPage from './pages/auth/LoginPage'

// Route components are lazy-loaded so heavy dependencies (Three.js on the
// furniture pages, jsPDF on exports) are split into their own chunks and only
// fetched when the user actually visits those routes — not on first paint.
const ProjectsPage = lazy(() => import('./pages/projects/ProjectsPage'))
const NewProjectPage = lazy(() => import('./pages/projects/NewProjectPage'))
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'))
const NewLogEntryPage = lazy(() => import('./pages/projects/NewLogEntryPage'))
const LogTypesPage = lazy(() => import('./pages/log-types/LogTypesPage'))
const NewLogTypePage = lazy(() => import('./pages/log-types/NewLogTypePage'))
const LogTypeDetailPage = lazy(() => import('./pages/log-types/LogTypeDetailPage'))
const ProductsPage = lazy(() => import('./pages/products/ProductsPage'))
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage'))
const QuotationsPage = lazy(() => import('./pages/quotations/QuotationsPage'))
const FloorPlanQuotationPage = lazy(() => import('./pages/quotations/FloorPlanQuotationPage'))
const NewQuotationPage = lazy(() => import('./pages/quotations/NewQuotationPage'))
const QuotationDetailPage = lazy(() => import('./pages/quotations/QuotationDetailPage'))
const EditQuotationPage = lazy(() => import('./pages/quotations/EditQuotationPage'))
const FurnitureListPage = lazy(() => import('./pages/furniture/FurnitureListPage'))
const FurnitureDesignerPage = lazy(() => import('./pages/furniture/FurnitureDesignerPage'))
const UsersPage = lazy(() => import('./pages/users/UsersPage'))

// Lightweight fallback shown while a route chunk loads.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24" style={{ color: 'var(--ink-4)' }}>
      <span className="save-spinner" aria-hidden="true" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Everything below requires a valid session */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/projects" replace />} />

            {/* Projects */}
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/new" element={<NewProjectPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="projects/:id/logs/new" element={<NewLogEntryPage />} />

            {/* Log Types (admin) */}
            <Route path="log-types" element={<LogTypesPage />} />
            <Route path="log-types/new" element={<NewLogTypePage />} />
            <Route path="log-types/:id" element={<LogTypeDetailPage />} />

            {/* Products catalog */}
            <Route path="products" element={<ProductsPage />} />
            <Route path="inventory" element={<InventoryPage />} />

            {/* Quotations */}
            <Route path="quotations" element={<QuotationsPage />} />
            <Route path="quotations/from-floor-plan" element={<FloorPlanQuotationPage />} />
            <Route path="quotations/new" element={<NewQuotationPage />} />
            <Route path="quotations/:id/edit" element={<EditQuotationPage />} />
            <Route path="quotations/:id" element={<QuotationDetailPage />} />

            {/* Furniture Designer */}
            <Route path="furniture" element={<FurnitureListPage />} />
            <Route path="furniture/new" element={<FurnitureDesignerPage />} />
            <Route path="furniture/:id" element={<FurnitureDesignerPage />} />

            {/* Team / User management — admin only */}
            <Route
              path="users"
              element={
                <RequireRole allow={['admin', 'super_admin']}>
                  <UsersPage />
                </RequireRole>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
