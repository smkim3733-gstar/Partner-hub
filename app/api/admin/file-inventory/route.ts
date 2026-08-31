import {
  requireInventoryAdmin,
  listFileInventory,
  inventoryJson,
  inventoryError,
} from '@/lib/file-inventory-store';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const state = await requireInventoryAdmin(request);
    return inventoryJson(await listFileInventory(new URL(request.url), state));
  } catch (error) {
    return inventoryError(error);
  }
}
