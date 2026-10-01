/**
 * Development seed: studio assets, the launch rate card, zones, a sample franchise and its
 * commission rules. Every step is an upsert, so running it twice is harmless.
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaClient, type ProductType } from '@prisma/client';
import { sampleRules } from '@neon-adda/shared';

const prisma = new PrismaClient();

const FONTS = [
  { name: 'Neon Script', family: 'Neonderthaw', styleTag: 'SCRIPT' },
  { name: 'Tilt Neon', family: 'Tilt Neon', styleTag: 'MODERN' },
  { name: 'Pacifico', family: 'Pacifico', styleTag: 'SCRIPT' },
  { name: 'Great Vibes', family: 'Great Vibes', styleTag: 'SCRIPT' },
  { name: 'Dancing', family: 'Dancing Script', styleTag: 'SCRIPT' },
  { name: 'Satisfy', family: 'Satisfy', styleTag: 'SCRIPT' },
  { name: 'Yellowtail', family: 'Yellowtail', styleTag: 'RETRO' },
  { name: 'Lobster', family: 'Lobster', styleTag: 'RETRO' },
  { name: 'Monoton', family: 'Monoton', styleTag: 'MARQUEE' },
  { name: 'Righteous', family: 'Righteous', styleTag: 'BLOCK' },
  { name: 'Bungee', family: 'Bungee', styleTag: 'BLOCK' },
  { name: 'Sacramento', family: 'Sacramento', styleTag: 'SCRIPT' },
];

const COLORS = [
  { name: 'Hot Pink', tubeHex: '#FFD1EA', glowHex: '#FF2E88' },
  { name: 'Ice Blue', tubeHex: '#DDF8FF', glowHex: '#22D3EE' },
  { name: 'Cool White', tubeHex: '#FFFFFF', glowHex: '#E6F0FF' },
  { name: 'Warm White', tubeHex: '#FFF6E0', glowHex: '#FFD89A' },
  { name: 'Lemon Yellow', tubeHex: '#FFF9C4', glowHex: '#FACC15' },
  { name: 'Orange', tubeHex: '#FFE0C2', glowHex: '#F97316' },
  { name: 'Red', tubeHex: '#FFD6D6', glowHex: '#EF4444' },
  { name: 'Lime Green', tubeHex: '#EEFFD1', glowHex: '#84CC16' },
  { name: 'Green', tubeHex: '#D8FFE6', glowHex: '#22C55E' },
  { name: 'Blue', tubeHex: '#DCE6FF', glowHex: '#3B82F6' },
  { name: 'Purple', tubeHex: '#EEE0FF', glowHex: '#8B5CF6' },
  { name: 'Pink Lavender', tubeHex: '#FBE4FF', glowHex: '#D946EF' },
];

const BACKBOARDS = [
  { code: 'CLR_CUT', name: 'Clear acrylic, cut to shape', material: 'Clear acrylic', shape: 'CUT_TO_SHAPE' },
  { code: 'CLR_RECT', name: 'Clear acrylic, rectangle', material: 'Clear acrylic', shape: 'RECTANGLE' },
  { code: 'BLK_ACR', name: 'Black acrylic, rectangle', material: 'Black acrylic', shape: 'RECTANGLE' },
  { code: 'PRINTED', name: 'Printed backboard', material: 'UV printed acrylic', shape: 'RECTANGLE' },
];

const BACKGROUNDS = [
  { code: 'BRICK', name: 'Brick wall', pxPerInch: 8 },
  { code: 'BEDROOM', name: 'Bedroom', pxPerInch: 7 },
  { code: 'CAFE', name: 'Café', pxPerInch: 6 },
  { code: 'DARK', name: 'Dark studio', pxPerInch: 8 },
];

const PERMISSIONS = [
  'dashboard.read',
  'orders.read',
  'orders.update',
  'quotations.read',
  'quotations.write',
  'customers.read',
  'franchises.read',
  'franchises.write',
  'pricing.read',
  'pricing.write',
  'pricing.publish',
  'commission.read',
  'commission.write',
  'commission.approve',
  'payouts.write',
  'payments.write',
  'catalog.write',
  'users.read',
  'users.write',
  'settings.write',
] as const;

type Permission = (typeof PERMISSIONS)[number];

const ROLES: { key: string; name: string; permissions: readonly Permission[] }[] = [
  { key: 'super_admin', name: 'Super admin', permissions: PERMISSIONS },
  {
    key: 'operations',
    name: 'Operations',
    permissions: [
      'dashboard.read',
      'orders.read',
      'orders.update',
      'quotations.read',
      'customers.read',
      'franchises.read',
      'pricing.read',
    ],
  },
  {
    key: 'sales',
    name: 'Sales',
    permissions: [
      'dashboard.read',
      'orders.read',
      'quotations.read',
      'quotations.write',
      'customers.read',
      'pricing.read',
    ],
  },
  { key: 'designer', name: 'Designer', permissions: ['orders.read', 'quotations.read', 'catalog.write'] },
  {
    key: 'accounts',
    name: 'Accounts',
    permissions: [
      'dashboard.read',
      'orders.read',
      'customers.read',
      'franchises.read',
      'pricing.read',
      'commission.read',
      'commission.approve',
      'payouts.write',
      'payments.write',
    ],
  },
];

type Tube = { text: string; color: keyof typeof GLOW };

const GLOW = {
  'Hot Pink': ['#FF2E88', '#FFD1EA'],
  'Ice Blue': ['#22D3EE', '#DDF8FF'],
  'Warm White': ['#FFD89A', '#FFF6E0'],
  'Lemon Yellow': ['#FACC15', '#FFF9C4'],
  Purple: ['#8B5CF6', '#EEE0FF'],
  Red: ['#EF4444', '#FFD6D6'],
  Green: ['#22C55E', '#D8FFE6'],
  Orange: ['#F97316', '#FFE0C2'],
} as const;

const CATEGORIES = [
  {
    slug: 'words-and-quotes',
    name: 'Words and quotes',
    description: 'Short lines that set the mood, ready to hang.',
  },
  {
    slug: 'weddings-and-events',
    name: 'Weddings and events',
    description: 'Backdrops for the stage, the photo booth and the mehendi.',
  },
  {
    slug: 'home-and-bedroom',
    name: 'Home and bedroom',
    description: 'Soft light for walls, shelves and headboards.',
  },
  {
    slug: 'cafes-and-business',
    name: 'Cafés and business',
    description: 'Signs that get your counter photographed.',
  },
];

/** Ready-made signs. Sizes follow each design's proportions, so the heights are not all the same ratio. */
const READYMADE: {
  slug: string;
  name: string;
  category: string;
  lines: Tube[];
  font: string;
  backboard: string;
  sizes: [number, number][];
  tags: string[];
  featured?: boolean;
  description: string;
}[] = [
  {
    slug: 'good-vibes-only',
    name: 'Good Vibes Only',
    category: 'words-and-quotes',
    lines: [
      { text: 'Good vibes', color: 'Hot Pink' },
      { text: 'only', color: 'Hot Pink' },
    ],
    font: 'Neonderthaw',
    backboard: 'CLR_CUT',
    sizes: [
      [18, 11],
      [24, 14],
      [36, 21],
    ],
    tags: ['bedroom', 'quotes', 'gift'],
    featured: true,
    description: 'The line that started a thousand bedroom makeovers, in a flowing script.',
  },
  {
    slug: 'but-first-coffee',
    name: 'But First, Coffee',
    category: 'cafes-and-business',
    lines: [
      { text: 'But first,', color: 'Warm White' },
      { text: 'coffee', color: 'Warm White' },
    ],
    font: 'Yellowtail',
    backboard: 'CLR_CUT',
    sizes: [
      [18, 11],
      [24, 15],
      [36, 22],
    ],
    tags: ['cafe', 'business', 'kitchen', 'quotes'],
    featured: true,
    description: 'A warm white classic for the café counter or the kitchen at home.',
  },
  {
    slug: 'better-together',
    name: 'Better Together',
    category: 'weddings-and-events',
    lines: [
      { text: 'Better', color: 'Warm White' },
      { text: 'together', color: 'Warm White' },
    ],
    font: 'Great Vibes',
    backboard: 'CLR_RECT',
    sizes: [
      [24, 14],
      [36, 20],
      [48, 27],
    ],
    tags: ['wedding', 'events', 'gift'],
    featured: true,
    description: 'A stage backdrop favourite that goes home with the couple after the wedding.',
  },
  {
    slug: 'mr-and-mrs',
    name: 'Mr & Mrs',
    category: 'weddings-and-events',
    lines: [{ text: 'Mr & Mrs', color: 'Warm White' }],
    font: 'Great Vibes',
    backboard: 'CLR_CUT',
    sizes: [
      [24, 9],
      [36, 13],
      [48, 17],
    ],
    tags: ['wedding', 'events'],
    description: 'Made for the reception table, the car and every photo after.',
  },
  {
    slug: 'lets-party',
    name: "Let's Party",
    category: 'weddings-and-events',
    lines: [{ text: "Let's party", color: 'Purple' }],
    font: 'Monoton',
    backboard: 'BLK_ACR',
    sizes: [
      [24, 6],
      [36, 9],
      [48, 12],
    ],
    tags: ['party', 'events', 'bar'],
    description: 'Bold marquee lettering for sangeets, birthdays and the home bar.',
  },
  {
    slug: 'dream-big',
    name: 'Dream Big',
    category: 'home-and-bedroom',
    lines: [{ text: 'Dream big', color: 'Ice Blue' }],
    font: 'Pacifico',
    backboard: 'CLR_CUT',
    sizes: [
      [18, 7],
      [24, 9],
      [36, 13],
    ],
    tags: ['kids', 'bedroom', 'quotes'],
    description: 'A gentle night light for a child’s room that grows up with them.',
  },
  {
    slug: 'hello-gorgeous',
    name: 'Hello Gorgeous',
    category: 'cafes-and-business',
    lines: [
      { text: 'Hello', color: 'Hot Pink' },
      { text: 'gorgeous', color: 'Hot Pink' },
    ],
    font: 'Satisfy',
    backboard: 'CLR_CUT',
    sizes: [
      [18, 12],
      [24, 16],
      [36, 23],
    ],
    tags: ['salon', 'business', 'bedroom'],
    description: 'The mirror-wall sign for salons, studios and dressing rooms.',
  },
  {
    slug: 'game-on',
    name: 'Game On',
    category: 'home-and-bedroom',
    lines: [{ text: 'GAME ON', color: 'Green' }],
    font: 'Bungee',
    backboard: 'BLK_ACR',
    sizes: [
      [18, 5],
      [24, 7],
      [36, 10],
    ],
    tags: ['gaming', 'bedroom'],
    description: 'Block letters in electric green for the gaming setup.',
  },
  {
    slug: 'open',
    name: 'Open',
    category: 'cafes-and-business',
    lines: [{ text: 'OPEN', color: 'Red' }],
    font: 'Righteous',
    backboard: 'BLK_ACR',
    sizes: [
      [18, 7],
      [24, 9],
      [30, 11],
    ],
    tags: ['business', 'shop', 'cafe'],
    description: 'Tells the street you are open, from across the road.',
  },
  {
    slug: 'stay-wild',
    name: 'Stay Wild',
    category: 'words-and-quotes',
    lines: [
      { text: 'Stay', color: 'Orange' },
      { text: 'wild', color: 'Lemon Yellow' },
    ],
    font: 'Lobster',
    backboard: 'CLR_CUT',
    sizes: [
      [18, 13],
      [24, 17],
      [36, 26],
    ],
    tags: ['quotes', 'bedroom', 'gift'],
    description: 'Two colours, one attitude. Looks as good on a shelf as on the wall.',
  },
];

/** A starter pincode directory so address forms can fill in the city; production loads the full list. */
const PINCODES: [string, string, string, string][] = [
  ['411001', 'Pune', 'Pune', '27'],
  ['411004', 'Pune', 'Pune', '27'],
  ['411016', 'Pune', 'Pune', '27'],
  ['411038', 'Pune', 'Pune', '27'],
  ['400001', 'Mumbai', 'Mumbai', '27'],
  ['400050', 'Mumbai', 'Mumbai Suburban', '27'],
  ['110001', 'New Delhi', 'New Delhi', '07'],
  ['560001', 'Bengaluru', 'Bengaluru Urban', '29'],
  ['560034', 'Bengaluru', 'Bengaluru Urban', '29'],
  ['500001', 'Hyderabad', 'Hyderabad', '36'],
  ['600001', 'Chennai', 'Chennai', '33'],
  ['380001', 'Ahmedabad', 'Ahmedabad', '24'],
  ['700001', 'Kolkata', 'Kolkata', '19'],
  ['302001', 'Jaipur', 'Jaipur', '08'],
  ['403001', 'Panaji', 'North Goa', '30'],
];

/** Sign-in for the development accounts below. Never seeded in production. */
const DEV_PASSWORD = 'NeonAdda@dev1';

async function main() {
  // Studio assets
  for (const [i, f] of FONTS.entries()) {
    const existing = await prisma.font.findFirst({ where: { family: f.family } });
    if (!existing) await prisma.font.create({ data: { ...f, sort: i } });
  }
  for (const [i, c] of COLORS.entries()) {
    const existing = await prisma.neonColor.findFirst({ where: { name: c.name } });
    if (!existing) await prisma.neonColor.create({ data: { ...c, sort: i } });
  }
  const backboards = new Map<string, string>();
  for (const [i, b] of BACKBOARDS.entries()) {
    const row = await prisma.backboard.upsert({
      where: { code: b.code },
      update: { name: b.name, material: b.material, shape: b.shape },
      create: { ...b, sort: i },
    });
    backboards.set(b.code, row.id);
  }
  for (const [i, b] of BACKGROUNDS.entries()) {
    await prisma.background.upsert({ where: { code: b.code }, update: {}, create: { ...b, sort: i } });
  }

  // Catalogue
  const custom = await prisma.category.upsert({
    where: { slug: 'custom-neon' },
    update: {},
    create: { name: 'Custom neon', slug: 'custom-neon', sort: 0 },
  });
  const logo = await prisma.category.upsert({
    where: { slug: 'logo-neon' },
    update: {},
    create: { name: 'Logo neon', slug: 'logo-neon', sort: 1 },
  });
  await prisma.product.upsert({
    where: { slug: 'custom-text-neon' },
    update: {},
    create: {
      categoryId: custom.id,
      type: 'TEXT_NEON',
      name: 'Custom text neon sign',
      slug: 'custom-text-neon',
      description: 'Your words in LED neon. Design it live in the Studio.',
      minWidthIn: 12,
      maxWidthIn: 96,
      minHeightIn: 4,
      maxHeightIn: 60,
      leadTimeDays: 7,
      isFeatured: true,
    },
  });
  await prisma.product.upsert({
    where: { slug: 'custom-logo-neon' },
    update: {},
    create: {
      categoryId: logo.id,
      type: 'LOGO_NEON',
      pricingMode: 'QUOTE',
      name: 'Custom logo neon sign',
      slug: 'custom-logo-neon',
      description: 'Upload your logo, preview it in neon and get a quotation.',
      leadTimeDays: 10,
    },
  });

  const categoryIds = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, seo: { description: c.description } },
      create: { name: c.name, slug: c.slug, sort: 10 + i, seo: { description: c.description } },
    });
    categoryIds.set(c.slug, row.id);
  }
  for (const p of READYMADE) {
    const data = {
      categoryId: categoryIds.get(p.category)!,
      type: 'READYMADE' as const,
      name: p.name,
      description: p.description,
      tags: p.tags,
      isFeatured: p.featured ?? false,
      minWidthIn: p.sizes[0]![0],
      maxWidthIn: p.sizes.at(-1)![0],
      minHeightIn: 4,
      maxHeightIn: 60,
      leadTimeDays: 5,
      defaultDesign: {
        lines: p.lines.map(({ text, color }) => ({
          text,
          colorName: color,
          glowHex: GLOW[color][0],
          tubeHex: GLOW[color][1],
        })),
        fontFamily: p.font,
        backboardCode: p.backboard,
      },
      specs: {
        sizes: p.sizes.map(([widthIn, heightIn], i) => ({
          label: ['Small', 'Medium', 'Large'][i]!,
          widthIn,
          heightIn,
        })),
        highlights: [
          'Flexible LED neon, cool to the touch',
          'Adapter and 2 m clear cable included',
          'Wall screws and standoffs in the box',
          '1-year warranty on the LEDs and adapter',
        ],
      },
    };
    await prisma.product.upsert({ where: { slug: p.slug }, update: data, create: { ...data, slug: p.slug } });
  }

  for (const [pincode, city, district, stateCode] of PINCODES) {
    await prisma.pincode.upsert({
      where: { pincode },
      update: {},
      create: { pincode, city, district, stateCode },
    });
  }

  // Rate card v1 (published)
  const v1 = await prisma.rateCardVersion.upsert({
    where: { versionNo: 1 },
    update: {},
    create: {
      versionNo: 1,
      status: 'PUBLISHED',
      effectiveFrom: new Date('2026-01-01T00:00:00+05:30'),
      publishedAt: new Date(),
      notes: 'Launch rates',
    },
  });
  for (const r of sampleRules.rates) {
    const backboardId = backboards.get(r.backboardCode)!;
    await prisma.rateCardEntry.upsert({
      where: {
        versionId_productType_backboardId: {
          versionId: v1.id,
          productType: r.productType as ProductType,
          backboardId,
        },
      },
      update: {},
      create: {
        versionId: v1.id,
        productType: r.productType as ProductType,
        backboardId,
        ratePerSqft: r.ratePerSqftPaise / 100,
        minBillableSqft: r.minBillableSqft,
      },
    });
  }
  for (const [i, a] of sampleRules.addons.entries()) {
    await prisma.addon.upsert({
      where: { code: a.code },
      update: {},
      create: {
        code: a.code,
        name: a.name,
        pricingType: a.pricingType,
        value: a.value,
        appliesTo: [],
        sort: i,
      },
    });
  }

  // Settings
  const pricingSetting = {
    multiColorSurchargePct: sampleRules.multiColorSurchargePct,
    gstRatePct: sampleRules.gstRatePct,
    hsnCode: sampleRules.hsnCode,
    companyStateCode: sampleRules.companyStateCode,
    minOrderValuePaise: sampleRules.minOrderValuePaise,
    maxQty: sampleRules.maxQty,
    advance: sampleRules.advance,
  };
  await prisma.setting.upsert({
    where: { key: 'pricing' },
    update: {},
    create: { key: 'pricing', value: pricingSetting },
  });
  await prisma.setting.upsert({
    where: { key: 'commission' },
    update: {},
    create: { key: 'commission', value: { eligibilityDays: 7, includeInstallation: false, tdsPct: 0 } },
  });

  // Seller details for tax invoices; finance fills in the GSTIN from Settings before go-live.
  await prisma.setting.upsert({
    where: { key: 'company' },
    update: {},
    create: { key: 'company', value: { legalName: 'Neon Adda', stateCode: sampleRules.companyStateCode } },
  });

  // Zones
  const zoneA = await prisma.serviceZone.upsert({
    where: { code: 'PUNE_A' },
    update: {},
    create: {
      code: 'PUNE_A',
      name: 'Pune city',
      deliveryChargePaise: 0n,
      installAvailable: true,
      installType: 'PER_SQFT',
      installValuePaise: 12000n,
      deliveryDaysMin: 5,
      deliveryDaysMax: 7,
    },
  });
  await prisma.serviceZone.upsert({
    where: { code: 'REST_OF_INDIA' },
    update: {},
    create: {
      code: 'REST_OF_INDIA',
      name: 'Rest of India',
      deliveryChargePaise: 19900n,
      freeDeliveryAbovePaise: 300000n,
      installAvailable: false,
      deliveryDaysMin: 7,
      deliveryDaysMax: 10,
    },
  });
  for (const pincode of ['411001', '411004', '411038']) {
    await prisma.zonePincode.upsert({
      where: { pincode },
      update: {},
      create: { zoneId: zoneA.id, pincode },
    });
  }

  // Coupon
  await prisma.coupon.upsert({
    where: { code: 'NEON10' },
    update: {},
    create: {
      code: 'NEON10',
      type: 'PERCENT',
      value: 10,
      maxDiscountPaise: 50000n,
      startsAt: new Date('2026-01-01'),
    },
  });

  // Franchise tiers, sample franchise, commission rules
  const silver = await prisma.franchiseTier.upsert({
    where: { name: 'Silver' },
    update: {},
    create: { name: 'Silver', sort: 0 },
  });
  const gold = await prisma.franchiseTier.upsert({
    where: { name: 'Gold' },
    update: {},
    create: { name: 'Gold', sort: 1 },
  });
  const pune = await prisma.franchise.upsert({
    where: { code: 'PUNEFC' },
    update: {},
    create: {
      code: 'PUNEFC',
      name: 'Neon Adda Pune, FC Road',
      tierId: gold.id,
      status: 'ACTIVE',
      city: 'Pune',
      stateCode: '27',
    },
  });
  for (const pincode of ['411004', '411016']) {
    await prisma.franchiseTerritory.upsert({
      where: { pincode },
      update: {},
      create: { franchiseId: pune.id, pincode },
    });
  }
  if ((await prisma.commissionRule.count()) === 0) {
    const from = new Date('2026-01-01T00:00:00+05:30');
    await prisma.commissionRule.createMany({
      data: [
        { scope: 'DEFAULT', source: 'SELF_SOURCED', type: 'PERCENT', value: 12, effectiveFrom: from },
        { scope: 'DEFAULT', source: 'ASSIGNED', type: 'PERCENT', value: 6, effectiveFrom: from },
        {
          scope: 'TIER',
          tierId: gold.id,
          source: 'SELF_SOURCED',
          type: 'PERCENT',
          value: 15,
          effectiveFrom: from,
        },
        {
          scope: 'TIER',
          tierId: silver.id,
          source: 'SELF_SOURCED',
          type: 'PERCENT',
          value: 12,
          effectiveFrom: from,
        },
      ],
    });
  }

  // Roles and permissions
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name },
      create: { key: role.key, name: role.name, isSystem: true },
    });
    const permissions = await prisma.permission.findMany({ where: { key: { in: [...role.permissions] } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: saved.id, permissionId: permission.id })),
    });
  }

  await seedOwnerAdmin();
  if (process.env.NODE_ENV !== 'production') await seedDevelopmentAccounts(pune.id);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * The first super admin, so a fresh deployment can be signed in to. Created once: a password
 * changed later is never overwritten. SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD override it.
 */
async function seedOwnerAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@gmail.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'Neon Adda Admin', type: 'STAFF', passwordHash: await hash(password) },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'super_admin' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
}

async function seedDevelopmentAccounts(franchiseId: string) {
  const passwordHash = await hash(DEV_PASSWORD);

  const staff = [{ email: 'ops@neonadda.test', name: 'Neha Kulkarni', role: 'operations' }];
  for (const member of staff) {
    const user = await prisma.user.upsert({
      where: { email: member.email },
      update: {},
      create: { email: member.email, name: member.name, type: 'STAFF', passwordHash },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: member.role } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  const owner = await prisma.user.upsert({
    where: { email: 'pune@neonadda.test' },
    update: {},
    create: {
      email: 'pune@neonadda.test',
      name: 'Meena Joshi',
      type: 'FRANCHISE',
      passwordHash,
      franchiseId,
    },
  });
  await prisma.franchise.update({ where: { id: franchiseId }, data: { ownerUserId: owner.id } });

  await prisma.technician.upsert({
    where: { phone: '+919000000001' },
    update: {},
    create: { name: 'Ravi Kumar', phone: '+919000000001', franchiseId, skills: ['installation', 'wiring'] },
  });

  console.log(`Development accounts ready (password for ops and partner: ${DEV_PASSWORD}).`);
}
