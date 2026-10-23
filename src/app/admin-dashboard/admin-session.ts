import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AdminSession {
  authorization = '';

  get isAuthenticated(): boolean {
    return this.authorization !== '';
  }

  signOut(): void {
    this.authorization = '';
  }
}
