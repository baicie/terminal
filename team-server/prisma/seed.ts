import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Create a demo user for testing
  const demoUser = await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo User',
    },
  })

  console.log(`✅ Created demo user: ${demoUser.name} (${demoUser.id})`)

  // Create a demo team
  const demoTeam = await prisma.team.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'Demo Team',
      ownerId: demoUser.id,
    },
  })

  console.log(`✅ Created demo team: ${demoTeam.name} (${demoTeam.id})`)

  // Add demo user as admin member
  const membership = await prisma.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId: demoTeam.id,
        userId: demoUser.id,
      },
    },
    update: {},
    create: {
      teamId: demoTeam.id,
      userId: demoUser.id,
      userName: demoUser.name,
      role: 'ADMIN',
    },
  })

  console.log(`✅ Added ${demoUser.name} as admin to ${demoTeam.name}`)

  // Create a demo invite
  const demoInvite = await prisma.invite.upsert({
    where: { code: 'DEMO-TEST-1234' },
    update: {},
    create: {
      teamId: demoTeam.id,
      type: 'CODE',
      code: 'DEMO-TEST-1234',
      role: 'MEMBER',
      createdBy: demoUser.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  console.log(`✅ Created demo invite code: ${demoInvite.code}`)

  console.log('\n🎉 Database seeded successfully!')
  console.log('\nDemo credentials:')
  console.log(`  User ID: ${demoUser.id}`)
  console.log(`  Team ID: ${demoTeam.id}`)
  console.log(`  Invite Code: ${demoInvite.code}`)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
