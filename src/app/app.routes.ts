import { Routes } from '@angular/router';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { Registration } from './boardGameRegistration/registration';

export const routes: Routes = [
  { path: '', component: Registration },
  { path: 'admin', component: AdminDashboard },
  { path: '**', redirectTo: '' },
];
