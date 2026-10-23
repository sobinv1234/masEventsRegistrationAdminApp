import { Routes } from '@angular/router';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { Registration } from './boardGameRegistration/registration';
import { MembershipRenewalForm } from './membership-renewal/membership-renewal';
import { MembershipRenewalsDashboard } from './membership-renewals-dashboard/membership-renewals-dashboard';
import { ContactDetailsForm } from './contact-details/contact-details';
import { ContactDetailsDashboard } from './contact-details-dashboard/contact-details-dashboard';

export const routes: Routes = [
  { path: '', component: Registration },
  { path: 'membership-renewal', component: MembershipRenewalForm },
  { path: 'contact-details', component: ContactDetailsForm },
  { path: 'admin', component: AdminDashboard },
  { path: 'admin/renewals', component: MembershipRenewalsDashboard },
  { path: 'admin/contact-details', component: ContactDetailsDashboard },
  { path: '**', redirectTo: '' },
];
