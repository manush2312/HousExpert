import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import ProjectsPage from './pages/projects/ProjectsPage'
import NewProjectPage from './pages/projects/NewProjectPage'
import ProjectDetailPage from './pages/projects/ProjectDetailPage'
import NewLogEntryPage from './pages/projects/NewLogEntryPage'
import LogTypesPage from './pages/log-types/LogTypesPage'
import NewLogTypePage from './pages/log-types/NewLogTypePage'
import LogTypeDetailPage from './pages/log-types/LogTypeDetailPage'
import ProductsPage from './pages/products/ProductsPage'
import QuotationsPage from './pages/quotations/QuotationsPage'
import NewQuotationPage from './pages/quotations/NewQuotationPage'
import QuotationDetailPage from './pages/quotations/QuotationDetailPage'
import EditQuotationPage from './pages/quotations/EditQuotationPage'
import FurnitureListPage from './pages/furniture/FurnitureListPage'
import FurnitureDesignerPage from './pages/furniture/FurnitureDesignerPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
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

          {/* Quotations */}
          <Route path="quotations" element={<QuotationsPage />} />
          <Route path="quotations/new" element={<NewQuotationPage />} />
          <Route path="quotations/:id/edit" element={<EditQuotationPage />} />
          <Route path="quotations/:id" element={<QuotationDetailPage />} />

          {/* Furniture Designer */}
          <Route path="furniture" element={<FurnitureListPage />} />
          <Route path="furniture/new" element={<FurnitureDesignerPage />} />
          <Route path="furniture/:id" element={<FurnitureDesignerPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
