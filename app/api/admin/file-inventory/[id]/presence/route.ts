import {
  requireInventoryAdmin,
  checkInventoryPresence,
  inventoryJson,
  inventoryError,
} from '@/lib/file-inventory-store';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireInventoryAdmin(request);
    const { id } = await context.params;
    return inventoryJson(await checkInventoryPresence(id));
  } catch (error) {
    return inventoryError(error);
  }
}
