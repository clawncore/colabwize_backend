import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    const userCount = await prisma.user.count()
    console.log(`Connection successful. Total users in database: ${userCount}`)
    
    if (userCount > 0) {
      const sampleUsers = await prisma.user.findMany({
        take: 3,
        select: { id: true, email: true, full_name: true }
      })
      console.log('Sample users:', JSON.stringify(sampleUsers, null, 2))
    }
  } catch (error) {
    console.error('Database query error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
