'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

/** Keeps focus inside an existing portal form and restores its opener on close. */
export function PortalDialog({
  titleId,
  onClose,
  closeDisabled = false,
  children,
}: {
  titleId: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open modal disablePointerDismissal onOpenChange={(open, event) => {
      if (!open) {
        if (closeDisabled) event.cancel();
        else onClose();
      }
    }}>
      <DialogContent
        aria-labelledby={titleId}
        showCloseButton={false}
        initialFocus
        finalFocus
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-2xl"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
