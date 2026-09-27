// backend/src/modules/auth/auth.service.ts
// ==================================================================
// Zero Plus - Auth Service
// كل المنطق الخاص بالتسجيل والدخول موجود هنا
// ==================================================================

import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { Prisma } from '@prisma/client'
import type { SignupInput, LoginInput } from './auth.schema.js'

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const SALT_ROUNDS = 12

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// بنحوّل اسم الشركة لـ slug بسيط (حروف صغيرة + شرطات)
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')      // نشيل الرموز الغريبة
    .replace(/[\s_-]+/g, '-')      // نحول المسافات لشرطات
    .replace(/^-+|-+$/g, '')       // نشيل الشرطات من الأول والآخر
}

// ------------------------------------------------------------------
// Signup
// ------------------------------------------------------------------
export async function signup(
  fastify: FastifyInstance,
  data: SignupInput
) {
  const { organizationName, fullName, email, password } = data

  // نتأكد إن الإيميل مش مستخدم قبل كده
  const existingUser = await fastify.prisma.user.findUnique({
    where: { email },
  })

  if (existingUser) {
    throw new Error('EMAIL_ALREADY_EXISTS')
  }

  // نجهز الـ slug ونتأكد إنه فريد
  let slug = generateSlug(organizationName)
  const existingOrg = await fastify.prisma.organization.findUnique({
    where: { slug },
  })

  // لو الـ slug موجود، نضيف رقم عشوائي بسيط
  if (existingOrg) {
    slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`
  }

  const passwordHash = await hashPassword(password)

  // بنعمل Transaction عشان لو حاجة فشلت، مفيش بيانات ناقصة تتسجل
  const result = await fastify.prisma.$transaction(async (tx) => {
    // 1. نعمل الـ Organization
    const organization = await tx.organization.create({
      data: {
        name: organizationName,
        slug,
        plan: 'free',
        isActive: true,
      },
    })

    // 2. نعمل الـ User بدور OWNER
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: 'OWNER',
        organizationId: organization.id,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organizationId: true,
        createdAt: true,
      },
    })

    // 3. نعمل Policy افتراضية للشركة (اختياري بس مستحسن)
    await tx.policy.create({
      data: {
        organizationId: organization.id,
        // القيم الافتراضية هتتاخد من الـ schema
      },
    })

    return { user, organization }
  })

  // نصدر التوكن
  const token = fastify.jwt.sign({
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    organizationId: result.user.organizationId,
  })

  return {
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      role: result.user.role,
      organizationId: result.user.organizationId,
    },
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
    },
  }
}

// ------------------------------------------------------------------
// Login
// ------------------------------------------------------------------
export async function login(
  fastify: FastifyInstance,
  data: LoginInput
) {
  const { email, password } = data

  const user = await fastify.prisma.user.findUnique({
    where: { email },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
        },
      },
    },
  })

  if (!user) {
    throw new Error('INVALID_CREDENTIALS')
  }

  if (!user.isActive) {
    throw new Error('ACCOUNT_DISABLED')
  }

  if (!user.organization.isActive) {
    throw new Error('ORGANIZATION_DISABLED')
  }

  const isPasswordValid = await comparePassword(password, user.passwordHash)

  if (!isPasswordValid) {
    throw new Error('INVALID_CREDENTIALS')
  }

  // نحدّث آخر تسجيل دخول
  await fastify.prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // نصدر التوكن
  const token = fastify.jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  })

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    },
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
    },
  }
}

// ------------------------------------------------------------------
// Get Current User (للـ /me endpoint)
// ------------------------------------------------------------------
export async function getMe(fastify: FastifyInstance, userId: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      organizationId: true,
      lastLoginAt: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
        },
      },
    },
  })

  if (!user) {
    throw new Error('USER_NOT_FOUND')
  }

  return user
}