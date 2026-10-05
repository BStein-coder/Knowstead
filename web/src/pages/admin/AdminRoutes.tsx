import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '../../lib/auth';
import { AdminOverview } from './Overview';
import { AdminUsers } from './Users';
import { AdminGroups, AdminPermissions } from './Groups';
import { AdminDirectory } from './Directory';
import { AdminSso } from './Sso';
import { AdminAi } from './Ai';
import { AdminMail } from './Mail';
import { AdminExportTemplate } from './ExportTemplate';
import { AdminSpaces } from './Spaces';
import { AdminSettings } from './Settings';
import { AdminTemplates } from './Templates';
import { AdminWebhooks } from './Webhooks';
import { AdminConnectors } from './Connectors';
import { AdminPlugins } from './Plugins';
import { AdminAudit } from './Audit';
import { AdminBackups, AdminMaintenance } from './Backups';
import { AdminAbout } from './About';
import { AdminSetup } from './Setup';

export default function AdminRoutes() {
  const { isAdmin, can } = useAuth();
  const fallback = isAdmin
    ? '/admin'
    : can('users.manage')
      ? '/admin/users'
      : can('integrations.manage')
        ? '/admin/webhooks'
        : can('audit.view')
          ? '/admin/audit'
          : can('templates.manage')
            ? '/admin/templates'
            : '/admin/about';
  return (
    <div className="container admin-layout">
      <Routes>
        <Route index element={isAdmin ? <AdminOverview /> : <Navigate to={fallback} replace />} />
        <Route path="setup" element={isAdmin ? <AdminSetup /> : <Navigate to={fallback} replace />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="groups" element={<AdminGroups />} />
        <Route path="permissions" element={<AdminPermissions />} />
        <Route path="directory" element={<AdminDirectory />} />
        <Route path="sso" element={<AdminSso />} />
        <Route path="ai" element={<AdminAi />} />
        <Route path="mail" element={<AdminMail />} />
        <Route path="spaces" element={<AdminSpaces />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="templates" element={<AdminTemplates />} />
        <Route path="export" element={<AdminExportTemplate />} />
        <Route path="webhooks" element={<AdminWebhooks />} />
        <Route path="connectors" element={<AdminConnectors />} />
        <Route path="plugins" element={<AdminPlugins />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="backups" element={<AdminBackups />} />
        <Route path="maintenance" element={<AdminMaintenance />} />
        <Route path="about" element={<AdminAbout />} />
        <Route path="*" element={<Navigate to={fallback} replace />} />
      </Routes>
    </div>
  );
}
