import { useSyncExternalStore } from 'react';
import { authVersion, currentUser, isAdminKnown, subscribeAuth } from './supabase';
import { isCoverAdminOn, subscribeCoverAdmin } from './books';

/**
 * Admin tools are SHOWN only to a signed-in admin with developer mode ON. With developer mode off the admin sees the app exactly as a regular reader does.
 * (What admin devices quietly do in the background, such as sharing lists, is separate and not affected.)
 */
export const adminUiOn = (): boolean => isCoverAdminOn() && !!currentUser() && isAdminKnown() === true;

export function useAdminUi(): boolean {
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  useSyncExternalStore(subscribeCoverAdmin, isCoverAdminOn, isCoverAdminOn);
  return adminUiOn();
}
