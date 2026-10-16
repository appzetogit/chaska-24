/**
 * Launch data for Indore and Jaipur: two zones, 20 approved restaurants each
 * with a 20-dish menu and restaurant-wide add-ons, 10 approved delivery
 * partners per zone, and the admin-configured platform settings (cuisines,
 * global categories, coupons, banners, fee/referral/cashback settings,
 * feature flags, legal/about pages, a surge rule, one sub-admin) so every
 * "admin adds this" sidebar section has something in it.
 *
 * Idempotent throughout: zone/city by name, restaurants by the
 * name+phone unique pair, dishes by restaurant+name, partners by phone,
 * coupons by code, cuisines by slug, settings singletons by finding the
 * first row. Re-running updates rather than duplicating.
 *
 *   node scripts/seed-chaska-launch.mjs
 */
import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../src/modules/food/restaurant/restaurant.mapper.js';
import { hashAdminPassword } from '../src/core/auth/adminPassword.util.js';
import { invalidateActiveZonesCache } from '../src/modules/food/landing/controllers/zonePublic.controller.js';
import { invalidateCache } from '../src/middleware/cache.js';

// ── a working pool of stock photos, reused across restaurants/dishes/banners ──
const IMG = [
    '1517248135467-4c7edcad34c4', '1565299624946-b28f40a0ae38', '1565958011703-44f9829ba187',
    '1565299507177-b0ac66763828', '1586190848861-99aa4a171e90', '1567620905732-2d1ec7ab7445',
    '1540189549336-e6e99c3679fe', '1565557623262-b51c2513a641', '1601050690597-df0568f70950',
    '1631452180519-c014fe946bc7', '1589302168068-964664d93dc0', '1604908176997-125f25cc6f3d',
    '1546069901-ba9599a7e63c', '1551504734-5ee1c4a1479b', '1555939594-58d7cb561ad1',
    '1563379926898-05f4575a45d8', '1476718406336-bb5a9690ee2a', '1484723091739-30a097e8f929',
    '1490645935967-10de6ba17061', '1528735602780-2552fd46c7af', '1512058564366-18510be2db19',
    '1551183053-bf91a1d81141', '1528712306091-ed0763094c98', '1603360946369-dc9bb6258143',
    '1626074353765-517a681e40be', '1618160702438-9b02ab6515c9', '1571091718767-18b5b1457add',
    '1569058242253-92a9c755a0ec', '1550547660-d9450f859349', '1546833999-b9f581a1996d',
    '1552566626-52f8b828add9', '1568901346375-23c9450c58cd', '1559339352-11d035aa65de',
].map((id) => `https://images.unsplash.com/photo-${id}?w=800&q=70&auto=format&fit=crop`);
const img = (i) => IMG[i % IMG.length];

// ── cities + zones ─────────────────────────────────────────────────────────
const ZONES = [
    {
        cityName: 'Indore', state: 'Madhya Pradesh', center: [22.7196, 75.8577],
        areas: [
            'Vijay Nagar', 'Palasia', 'Rajwada', 'Bhawarkuan', 'MG Road', 'Sapna Sangeeta',
            'Geeta Bhawan', 'AB Road', 'Sudama Nagar', 'Rau', 'Pipliyahana', 'Scheme 54',
            'New Palasia', 'LIG Colony', 'Annapurna', 'Tilak Nagar', 'South Tukoganj',
            'Khajrana', 'Bengali Square', 'Nipania',
        ],
        pincodeBase: 452001,
    },
    {
        cityName: 'Jaipur', state: 'Rajasthan', center: [26.9124, 75.7873],
        areas: [
            'C-Scheme', 'Malviya Nagar', 'Vaishali Nagar', 'Mansarovar', 'Raja Park', 'Civil Lines',
            'Tonk Road', 'Bani Park', 'Jagatpura', 'Jhotwara', 'Sanganer', 'Vidhyadhar Nagar',
            'Shyam Nagar', 'Ajmer Road', 'Gopalpura', 'Lal Kothi', 'Sodala', 'Adarsh Nagar',
            'Durgapura', 'Jawahar Nagar',
        ],
        pincodeBase: 302001,
    },
];

const NAME_TEMPLATES = [
    '{a} Spice Kitchen', '{a} Biryani House', '{a} Tadka Dhaba', '{a} Punjabi Rasoi',
    '{a} Chinese Corner', '{a} Pizza Point', '{a} Burger Hub', '{a} South Spice',
    '{a} Sweets & Snacks', '{a} Food Junction', '{a} Grill & Chill', '{a} Royal Thali',
    '{a} Zaika', '{a} Bites & Bowls', '{a} Curry Leaf', '{a} Tandoor Express',
    '{a} Momo Point', '{a} Cafe Delight', '{a} Rasoi Ghar', '{a} Tiffin Box',
];

const CUISINE_SETS = [
    ['North Indian', 'Mughlai'], ['Biryani', 'North Indian'], ['North Indian', 'Punjabi'],
    ['Punjabi', 'North Indian'], ['Chinese', 'Fast Food'], ['Pizza', 'Italian'],
    ['Fast Food', 'Burgers'], ['South Indian', 'Breakfast'], ['Sweets', 'Snacks'],
    ['Fast Food', 'Chinese'], ['Continental', 'Fast Food'], ['North Indian', 'Thali'],
    ['North Indian', 'Chinese'], ['Street Food', 'Fast Food'], ['North Indian', 'Mughlai'],
    ['North Indian', 'Tandoor'], ['Tibetan', 'Chinese'], ['Cafe', 'Continental'],
    ['North Indian', 'Punjabi'], ['Breakfast', 'North Indian'],
];

// ── shared menu catalog: [name, price, foodType, categoryKey, imgIdx] ────────
const DISHES = [
    ['Paneer Butter Masala', 240, 'Veg', 'main', 0], ['Dal Makhani', 200, 'Veg', 'main', 1],
    ['Butter Chicken', 320, 'NonVeg', 'main', 2], ['Chicken Tikka Masala', 300, 'NonVeg', 'main', 3],
    ['Shahi Paneer', 250, 'Veg', 'main', 4], ['Kadai Chicken', 310, 'NonVeg', 'main', 5],
    ['Veg Kolhapuri', 220, 'Veg', 'main', 6], ['Mutton Rogan Josh', 380, 'NonVeg', 'main', 7],
    ['Chole Bhature', 150, 'Veg', 'main', 8], ['Rajma Chawal', 160, 'Veg', 'main', 9],
    ['Tandoori Roti', 25, 'Veg', 'breads', 10], ['Butter Naan', 45, 'Veg', 'breads', 11],
    ['Garlic Naan', 60, 'Veg', 'breads', 12], ['Lachha Paratha', 50, 'Veg', 'breads', 13],
    ['Chicken Biryani', 260, 'NonVeg', 'biryani', 14], ['Veg Biryani', 190, 'Veg', 'biryani', 15],
    ['Mutton Biryani', 340, 'NonVeg', 'biryani', 16], ['Jeera Rice', 140, 'Veg', 'biryani', 17],
    ['Veg Fried Rice', 150, 'Veg', 'chinese', 18], ['Chicken Fried Rice', 190, 'NonVeg', 'chinese', 19],
    ['Veg Hakka Noodles', 150, 'Veg', 'chinese', 20], ['Chicken Manchurian', 220, 'NonVeg', 'chinese', 21],
    ['Paneer Chilli', 210, 'Veg', 'chinese', 22], ['Spring Rolls', 150, 'Veg', 'chinese', 23],
    ['Masala Dosa', 110, 'Veg', 'south', 24], ['Idli Sambhar', 90, 'Veg', 'south', 25],
    ['Medu Vada', 80, 'Veg', 'south', 26], ['Uttapam', 100, 'Veg', 'south', 27],
    ['Margherita Pizza', 220, 'Veg', 'pizza', 28], ['Farmhouse Pizza', 280, 'Veg', 'pizza', 29],
    ['Chicken Pizza', 320, 'NonVeg', 'pizza', 30], ['Veg Burger', 110, 'Veg', 'burger', 31],
    ['Chicken Burger', 150, 'NonVeg', 'burger', 32], ['Paneer Tikka', 240, 'Veg', 'starters', 0],
    ['Chicken 65', 230, 'NonVeg', 'starters', 2], ['Veg Manchurian', 180, 'Veg', 'starters', 22],
    ['Gulab Jamun', 80, 'Veg', 'dessert', 5], ['Rasgulla', 70, 'Veg', 'dessert', 6],
    ['Ice Cream', 90, 'Veg', 'dessert', 8], ['Gajar Halwa', 100, 'Veg', 'dessert', 9],
    ['Lassi', 70, 'Veg', 'beverage', 11], ['Cold Coffee', 90, 'Veg', 'beverage', 13],
    ['Masala Chai', 30, 'Veg', 'beverage', 15], ['Fresh Lime Soda', 50, 'Veg', 'beverage', 17],
];

const ADDON_TEMPLATES = [
    ['Extra Cheese', 40, 'veg'], ['Butter Extra', 20, 'veg'], ['Cold Drink (250ml)', 40, 'veg'],
    ['Raita', 30, 'veg'], ['Papad', 20, 'veg'], ['Extra Gravy', 50, 'veg'],
];

const CATEGORY_DEFS = [
    ['Main Course', 'main'], ['Breads', 'breads'], ['Rice & Biryani', 'biryani'],
    ['Chinese', 'chinese'], ['South Indian', 'south'], ['Pizza', 'pizza'],
    ['Burgers', 'burger'], ['Starters', 'starters'], ['Desserts', 'dessert'], ['Beverages', 'beverage'],
];

const CUISINES = [
    'North Indian', 'South Indian', 'Chinese', 'Fast Food', 'Biryani', 'Punjabi', 'Mughlai',
    'Desserts', 'Sweets', 'Beverages', 'Pizza', 'Italian', 'Continental', 'Street Food',
    'Tandoor', 'Thali', 'Cafe', 'Tibetan', 'Burgers', 'Breakfast',
];

const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, ' ');

// ── delivery partner names ────────────────────────────────────────────────
const PARTNER_NAMES = [
    'Rahul Sharma', 'Amit Verma', 'Suresh Patel', 'Vijay Singh', 'Rohit Kumar', 'Manoj Yadav',
    'Deepak Chouhan', 'Sanjay Mishra', 'Ajay Rathore', 'Vikas Jain', 'Kiran Meena', 'Gaurav Soni',
    'Naveen Gupta', 'Pankaj Sharma', 'Ravi Shekhawat', 'Sunil Chauhan', 'Arjun Rawat', 'Mohit Saini',
    'Rakesh Joshi', 'Harish Choudhary',
];

let restaurantCount = 0;
let itemCount = 0;
let addonCount = 0;
let partnerCount = 0;

// ── global categories (admin-created, visible everywhere) ─────────────────
const CATS = {};
for (const [name, key] of CATEGORY_DEFS) {
    const existing = await prisma.foodCategory.findFirst({ where: { name, restaurantId: null, zoneId: null } });
    CATS[key] = existing ?? await prisma.foodCategory.create({
        data: { name, image: img(CATEGORY_DEFS.findIndex((c) => c[1] === key)), isApproved: true, isActive: true },
    });
}
console.log(`categories: ${Object.keys(CATS).length}`);

// ── cuisines ────────────────────────────────────────────────────────────────
let cuisineN = 0;
for (const [i, name] of CUISINES.entries()) {
    const slug = slugify(name);
    await prisma.foodCuisine.upsert({
        where: { slug },
        create: { name, slug, image: img(i), isActive: true, sortOrder: i },
        update: { name, isActive: true },
    });
    cuisineN += 1;
}
console.log(`cuisines: ${cuisineN}`);

// ── zones, restaurants, menus, addons, delivery partners ──────────────────
let restaurantPhoneSeq = 9001000001;
let partnerPhoneSeq = 9002000001;

for (const [zoneIdx, z] of ZONES.entries()) {
    const city = await prisma.foodCity.upsert({
        where: { nameKey: slugify(z.cityName) },
        create: { name: z.cityName, nameKey: slugify(z.cityName), state: z.state },
        // Always correct the name/state on conflict: a pre-existing row with
        // the right nameKey but wrong casing (e.g. hand-entered through the
        // admin UI) would otherwise keep its casing forever, and every
        // zone/sub-admin link below reads this name back.
        update: { name: z.cityName, state: z.state },
    });

    // Large circular ring (~18km radius) around the city centre -- generous
    // enough that every seeded restaurant/driver coordinate below falls inside.
    const [clat, clng] = z.center;
    const RADIUS = 0.17;
    const ring = Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * 2 * Math.PI;
        return { latitude: clat + RADIUS * Math.sin(angle), longitude: clng + RADIUS * Math.cos(angle) * 1.1 };
    });

    const zoneData = {
        name: z.cityName, zoneName: z.cityName, serviceLocation: z.cityName, country: 'India',
        city: city.name, cityId: city.id, unit: 'kilometer', coordinates: ring, isActive: true,
    };
    const existingZone = await prisma.foodZone.findFirst({ where: { name: { equals: z.cityName, mode: 'insensitive' } } });
    const zone = existingZone
        ? await prisma.foodZone.update({ where: { id: existingZone.id }, data: zoneData })
        : await prisma.foodZone.create({ data: zoneData });

    const [shape] = await prisma.$queryRaw`
        SELECT ST_IsValid(boundary::geometry) AS valid,
               ROUND((ST_Area(boundary) / 1e6)::numeric) AS km2
        FROM food_zones WHERE id = ${zone.id}`;
    console.log(`zone: ${zone.name} (${zone.id}) valid=${shape?.valid} area=${shape?.km2} km2`);

    // 20 restaurants, scattered within ~8km of the centre (well inside the ring).
    for (let i = 0; i < 20; i += 1) {
        const area = z.areas[i];
        const name = NAME_TEMPLATES[i].replace('{a}', area);
        const phone = String(restaurantPhoneSeq++);
        const angle = (i / 20) * 2 * Math.PI;
        const r = 0.02 + (i % 5) * 0.015;
        const lat = clat + r * Math.sin(angle);
        const lng = clng + r * Math.cos(angle);
        const pincode = String(z.pincodeBase + (i % 12));
        const cuisines = CUISINE_SETS[i];
        const veg = i % 4 === 0;
        const eta = `${20 + (i % 4) * 5}-${30 + (i % 4) * 5} mins`;

        const derived = deriveRestaurantFields({ restaurantName: name, ownerPhone: phone, estimatedDeliveryTime: eta });
        const location = fromRestaurantLocation({
            latitude: lat, longitude: lng,
            formattedAddress: `${area}, ${z.cityName}, ${z.state} ${pincode}`,
            addressLine1: area, area, city: z.cityName, state: z.state, pincode,
        });

        const coverA = img(zoneIdx * 20 + i);
        const coverB = img(zoneIdx * 20 + i + 7);
        const data = {
            restaurantName: name,
            ownerName: `${area} Owner`,
            ownerEmail: `owner.${phone}@chaska24by7.com`,
            ownerPhone: phone,
            primaryContactNumber: phone,
            ...derived,
            ...location,
            zoneId: zone.id,
            deliveryRadiusKm: 10,
            cuisines,
            openingTime: '09:00',
            closingTime: '23:00',
            openDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            pureVegRestaurant: veg,
            isAcceptingOrders: true,
            estimatedDeliveryTime: eta,
            featuredDish: DISHES[i % DISHES.length][0],
            featuredPrice: DISHES[i % DISHES.length][1],
            rating: (3.8 + (i % 10) / 10).toFixed(1),
            totalRatings: 50 + i * 17,
            profileImage: coverA,
            coverImages: [coverA, coverB],
            status: 'approved',
            approvedAt: new Date(),
        };

        const restaurant = await prisma.foodRestaurant.upsert({
            where: {
                restaurantNameNormalized_ownerPhoneLast10: {
                    restaurantNameNormalized: derived.restaurantNameNormalized,
                    ownerPhoneLast10: derived.ownerPhoneLast10,
                },
            },
            create: data,
            update: data,
        });
        restaurantCount += 1;

        // 20 dishes per restaurant, rotating through the shared catalog so menus
        // overlap realistically instead of needing 800 unique dish names.
        const offset = (zoneIdx * 20 + i) * 3;
        for (let d = 0; d < 20; d += 1) {
            const [dishName, price, foodType, catKey, imgIdx] = DISHES[(offset + d) % DISHES.length];
            const category = CATS[catKey];
            const image = img(imgIdx);
            const payload = {
                restaurantId: restaurant.id,
                name: dishName,
                price: price + (d % 3) * 10,
                foodType,
                categoryId: category?.id || null,
                categoryName: category?.name || '',
                image,
                images: [image],
                isAvailable: true,
                approvalStatus: 'approved',
                isRecommended: d < 3,
            };
            const found = await prisma.foodItem.findFirst({ where: { restaurantId: restaurant.id, name: dishName } });
            if (found) await prisma.foodItem.update({ where: { id: found.id }, data: payload });
            else await prisma.foodItem.create({ data: payload });
            itemCount += 1;
        }

        // Restaurant-wide add-ons (empty foodIds), already approved + published.
        for (const [aName, aPrice, foodType] of ADDON_TEMPLATES) {
            const draft = { name: aName, description: '', foodType, price: aPrice, image: '', images: [] };
            const existingAddon = await prisma.foodAddon.findFirst({
                where: { restaurantId: restaurant.id, draft: { path: ['name'], equals: aName } },
            });
            const addonData = {
                restaurantId: restaurant.id,
                foodIds: [],
                groupName: 'Add-ons',
                groupMinSelect: 0,
                groupMaxSelect: 1,
                draft,
                published: draft,
                approvalStatus: 'approved',
                approvedAt: new Date(),
                isAvailable: true,
            };
            if (existingAddon) await prisma.foodAddon.update({ where: { id: existingAddon.id }, data: addonData });
            else await prisma.foodAddon.create({ data: addonData });
            addonCount += 1;
        }

        if (i % 5 === 0) console.log(`  restaurant ${i + 1}/20: ${name} (${restaurant.id})`);
    }

    // 10 delivery partners per zone, approved.
    for (let i = 0; i < 10; i += 1) {
        const name = PARTNER_NAMES[(zoneIdx * 10 + i) % PARTNER_NAMES.length];
        const phone = String(partnerPhoneSeq++);
        const angle = (i / 10) * 2 * Math.PI;
        const lat = clat + 0.03 * Math.sin(angle);
        const lng = clng + 0.03 * Math.cos(angle);
        const data = {
            name, phone, email: `${name.toLowerCase().replace(/\s+/g, '.')}@chaska24by7.com`,
            address: z.areas[i % z.areas.length], city: z.cityName, state: z.state,
            vehicleType: i % 3 === 0 ? 'Bike' : 'Scooter',
            vehicleName: i % 3 === 0 ? 'Hero Splendor' : 'Honda Activa',
            vehicleNumber: `${z.cityName === 'Indore' ? 'MP09' : 'RJ14'}${String(1000 + zoneIdx * 10 + i)}`,
            status: 'approved',
            approvedAt: new Date(),
            availabilityStatus: 'offline',
            lastLat: lat,
            lastLng: lng,
            rating: (4.0 + (i % 8) / 10).toFixed(1),
            totalRatings: 20 + i * 5,
            totalDeliveries: 30 + i * 11,
        };
        const existingPartner = await prisma.foodDeliveryPartner.findUnique({ where: { phone } });
        if (existingPartner) await prisma.foodDeliveryPartner.update({ where: { phone }, data });
        else await prisma.foodDeliveryPartner.create({ data });
        partnerCount += 1;
    }

    // One surge rule and one home promotion banner per zone.
    const existingSurge = await prisma.foodSurgeRule.findFirst({ where: { zoneId: zone.id, label: `${z.cityName} Peak Hours` } });
    if (!existingSurge) {
        await prisma.foodSurgeRule.create({
            data: { label: `${z.cityName} Peak Hours`, surgeFee: 15, zoneId: zone.id, isActive: true },
        });
    }
    const existingPromo = await prisma.homePromotionBanner.findFirst({ where: { zoneId: zone.id, title: `${z.cityName} Launch Offer` } });
    if (!existingPromo) {
        await prisma.homePromotionBanner.create({
            data: { imageUrl: img(zoneIdx), publicId: `promo-${slugify(z.cityName)}`, title: `${z.cityName} Launch Offer`, zoneId: zone.id, isActive: true, sortOrder: zoneIdx },
        });
    }

    await invalidateActiveZonesCache().catch(() => {});
}

console.log(`restaurants: ${restaurantCount}, menu items: ${itemCount}, addons: ${addonCount}, delivery partners: ${partnerCount}`);

// ── coupons / offers ───────────────────────────────────────────────────────
const OFFERS = [
    { couponCode: 'WELCOME50', discountType: 'flat_price', discountValue: 50, customerScope: 'first_time', minOrderValue: 199, maxDiscount: 50 },
    { couponCode: 'FLAT20', discountType: 'percentage', discountValue: 20, customerScope: 'all', minOrderValue: 299, maxDiscount: 100 },
    { couponCode: 'SAVE100', discountType: 'flat_price', discountValue: 100, customerScope: 'all', minOrderValue: 499, maxDiscount: 100 },
    { couponCode: 'NEWUSER', discountType: 'percentage', discountValue: 30, customerScope: 'first_time', minOrderValue: 149, maxDiscount: 75 },
    { couponCode: 'WEEKEND15', discountType: 'percentage', discountValue: 15, customerScope: 'all', minOrderValue: 249, maxDiscount: 60, activeDays: [0, 6] },
];
for (const o of OFFERS) {
    await prisma.foodOffer.upsert({
        where: { couponCode: o.couponCode },
        create: { ...o, restaurantScope: 'all', status: 'active', showInCart: true, createdByRole: 'ADMIN', adminBearPercentage: 100 },
        update: { ...o, status: 'active' },
    });
}
console.log(`offers: ${OFFERS.length}`);

// ── offer banners ──────────────────────────────────────────────────────────
const OFFER_BANNERS = ['Flat 50% Off', 'Free Delivery Weekend', 'New User Special'];
for (const [i, title] of OFFER_BANNERS.entries()) {
    const existing = await prisma.foodOfferBanner.findFirst({ where: { title } });
    if (!existing) {
        await prisma.foodOfferBanner.create({
            data: { imageUrl: img(10 + i), publicId: `offer-${i}`, title, isActive: true, sortOrder: i },
        });
    }
}

// ── hero banners ────────────────────────────────────────────────────────────
const HERO_BANNERS = [
    { title: 'Order from your favourite restaurants', ctaText: 'Order Now' },
    { title: 'Fresh food, fast delivery', ctaText: 'Explore' },
    { title: 'Indore & Jaipur now live', ctaText: 'Discover' },
];
for (const [i, h] of HERO_BANNERS.entries()) {
    const existing = await prisma.foodHeroBanner.findFirst({ where: { title: h.title } });
    if (!existing) {
        await prisma.foodHeroBanner.create({
            data: { imageUrl: img(15 + i), publicId: `hero-${i}`, title: h.title, ctaText: h.ctaText, isActive: true, sortOrder: i },
        });
    }
}
console.log(`banners: ${OFFER_BANNERS.length} offer, ${HERO_BANNERS.length} hero`);

// ── referral settings (singleton) ──────────────────────────────────────────
{
    const existing = await prisma.foodReferralSettings.findFirst();
    const data = {
        referralRewardUser: 50, referralRewardDelivery: 100,
        referralLimitUser: 10, referralLimitDelivery: 20, isActive: true,
    };
    if (existing) await prisma.foodReferralSettings.update({ where: { id: existing.id }, data });
    else await prisma.foodReferralSettings.create({ data });
}

// ── cashback settings (singleton) ──────────────────────────────────────────
{
    const existing = await prisma.foodCashbackSettings.findFirst();
    const data = {
        isEnabled: true, cashbackType: 'percentage', cashbackValue: 5,
        minOrderValue: 199, maxCashback: 50, isActive: true,
    };
    if (existing) await prisma.foodCashbackSettings.update({ where: { id: existing.id }, data });
    else await prisma.foodCashbackSettings.create({ data });
}

// ── global fee settings + distance bands ───────────────────────────────────
{
    const existing = await prisma.foodFeeSettings.findFirst({ where: { zoneId: null } });
    const feeData = { deliveryFee: 30, platformFee: 5, quickDeliveryFee: 15, gstRate: 5, deliveryFeeGstRate: 0, riderMinPayPerTrip: 25, isActive: true };
    const fee = existing
        ? await prisma.foodFeeSettings.update({ where: { id: existing.id }, data: feeData })
        : await prisma.foodFeeSettings.create({ data: feeData });

    const bands = [
        { minDistanceKm: 0, maxDistanceKm: 3, fee: 25, deliveryBoyBasePay: 20 },
        { minDistanceKm: 3, maxDistanceKm: 7, fee: 40, deliveryBoyBasePay: 30 },
        { minDistanceKm: 7, maxDistanceKm: 15, fee: 60, deliveryBoyPerKm: 6 },
    ];
    const existingBands = await prisma.deliveryFeeBand.count({ where: { feeSettingsId: fee.id } });
    if (existingBands === 0) {
        for (const b of bands) {
            await prisma.deliveryFeeBand.create({ data: { ...b, feeSettingsId: fee.id } });
        }
    }
}
console.log('fee/referral/cashback settings: done');

// ── feature settings ─────────────────────────────────────────────────────
const FEATURES = [
    ['cod', 'Cash on Delivery'], ['live_tracking', 'Live Order Tracking'],
    ['dining', 'Dine-in / Table Booking'], ['subscription_billing', 'Restaurant Subscription Billing'],
    ['cashback', 'Cashback Rewards'], ['referral', 'Referral Program'],
    ['surge_pricing', 'Surge Pricing'], ['quick_delivery', 'Quick Delivery'],
];
for (const [key, name] of FEATURES) {
    await prisma.foodFeatureSetting.upsert({
        where: { key }, create: { key, name, isEnabled: true }, update: { name, isEnabled: true },
    });
}
console.log(`feature settings: ${FEATURES.length}`);

// ── legal / about pages ─────────────────────────────────────────────────────
const PAGES = [
    ['terms', { title: 'Terms & Conditions', content: '<h2>Terms &amp; Conditions</h2><p>By using Chaska you agree to our terms of service, covering ordering, payments, cancellations and delivery.</p>' }],
    ['privacy', { title: 'Privacy Policy', content: '<h2>Privacy Policy</h2><p>Chaska collects only the information needed to process your orders and deliveries, and never sells your data.</p>' }],
    ['refund', { title: 'Refund Policy', content: '<h2>Refund Policy</h2><p>Refunds for cancelled or undelivered orders are credited to your Chaska wallet within 24 hours.</p>' }],
    ['shipping', { title: 'Shipping Policy', content: '<h2>Delivery Policy</h2><p>Orders are delivered by our verified delivery partners within the estimated time shown at checkout.</p>' }],
    ['cancellation', { title: 'Cancellation Policy', content: '<h2>Cancellation Policy</h2><p>Orders can be cancelled before the restaurant accepts them. After acceptance, cancellation may incur charges.</p>' }],
    ['support', { title: 'Support', content: '<h2>Need help?</h2><p>Reach our support team any time from the Help section in the app, or email support@chaska24by7.com.</p>' }],
];
for (const [key, legal] of PAGES) {
    await prisma.foodPageContent.upsert({
        where: { key_module: { key, module: 'ALL' } },
        create: { key, module: 'ALL', legal: { ...legal, email: 'support@chaska24by7.com', mobile: '+91 9001000001' } },
        update: { legal: { ...legal, email: 'support@chaska24by7.com', mobile: '+91 9001000001' } },
    });
}
await prisma.foodPageContent.upsert({
    where: { key_module: { key: 'about', module: 'ALL' } },
    create: {
        key: 'about', module: 'ALL',
        about: {
            appName: 'Chaska', version: '1.0.0',
            description: 'Chaska connects you with the best restaurants in Indore and Jaipur, delivering fresh food fast.',
            features: ['Live order tracking', 'Multiple payment options', 'Exclusive restaurant offers'],
            stats: [{ label: 'Restaurants', value: '40+' }, { label: 'Cities', value: '2' }],
        },
    },
    update: {},
});
console.log(`page content: ${PAGES.length + 1} pages`);

// ── one sub-admin, scoped to both cities ───────────────────────────────────
{
    const email = 'ops@chaska24by7.com';
    const hash = await hashAdminPassword('ChaskaOps@123');
    const subAdmin = await prisma.foodAdmin.upsert({
        where: { email },
        create: { email, password: hash, name: 'Chaska Ops Manager', adminType: 'sub_admin', role: 'ADMIN', isActive: true },
        update: { password: hash, isActive: true },
    });
    const cities = await prisma.foodCity.findMany({ where: { name: { in: ['Indore', 'Jaipur'] } } });
    for (const c of cities) {
        await prisma.foodAdminCity.upsert({
            where: { adminId_cityId: { adminId: subAdmin.id, cityId: c.id } },
            create: { adminId: subAdmin.id, cityId: c.id },
            update: {},
        });
    }
    console.log(`sub-admin: ${email} / ChaskaOps@123 (cities: ${cities.map((c) => c.name).join(', ')})`);
}

await invalidateCache('restaurants:*').catch(() => {});
await invalidateCache('restaurant_detail:*').catch(() => {});
await invalidateCache('categories*').catch(() => {});

console.log('\ndone.');
await prisma.$disconnect();
process.exit(0);
