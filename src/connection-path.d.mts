import type { Device, ConnectionNode } from './types';
import type { SmartctlReport } from './smartctl-types';
export type PathLink = {
  label: string;
  kind: 'reported' | 'maximum' | 'current';
  maximum?: string | null;
} | null;
export type PathStage = {
  kind: 'host' | 'usb' | 'drive';
  name: string;
  role: 'host' | 'hub' | 'bridge' | 'usb' | 'drive';
  node: (ConnectionNode & { inquiryName?: string }) | null;
  link: PathLink;
  hints: { vendor: string; product: string; ambiguous: boolean } | null;
  inquiryName: string | null;
};
export function buildConnectionPath(
  device: Device | undefined,
  raw?: SmartctlReport | null,
  platform?: string,
): {
  stages: PathStage[];
  summary: 'unknown' | 'sata-lower';
  hasSpeeds: boolean;
  hasSataMaximumOnly: boolean;
};
export function usbDevices(
  chain: ConnectionNode[] | undefined,
): (ConnectionNode & { inquiryName?: string })[];
export function connectionRole(node: ConnectionNode): 'hub' | 'bridge' | 'usb';
export function sataSpeed(raw?: SmartctlReport | null): PathLink;
export function formatConnectionIdentifiers(
  stage: PathStage,
  labels?: {
    location?: string;
    inquiry?: string;
    vendor?: string;
    product?: string;
  },
): string;
