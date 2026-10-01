import { Address } from '@prisma/client';

/**
 * The address as it was when the order was placed. Orders keep their own copy so that editing
 * or deleting a saved address never changes where an existing order ships or what its invoice says.
 */
export function addressSnapshot(address: Address) {
  return {
    name: address.name,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    stateCode: address.stateCode,
    pincode: address.pincode,
    businessName: address.businessName,
    gstin: address.gstin,
  };
}

export type AddressSnapshot = ReturnType<typeof addressSnapshot>;
