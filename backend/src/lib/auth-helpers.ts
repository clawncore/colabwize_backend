import { prisma } from "./prisma";

/**
 * Check if a user has access to a project
 * Access is granted if:
 * 1. User is the owner of the project
 * 2. User is a collaborator on the project
 * 3. Project belongs to a workspace the user is a member of (with suitable role)
 */
export async function checkProjectAccess(projectId: string, userId: string): Promise<boolean> {
  if (!projectId || !userId) return false;

  try {
    // 1. Check if user is the owner or get workspace_id
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { user_id: true, workspace_id: true }
    });

    if (!project) return false;
    if (project.user_id === userId) return true;

    // 2. Check if user is a collaborator
    // Note: Use findUnique with @@unique([project_id, user_id])
    const collaborator = await prisma.collaboratorPresence.findUnique({
      where: {
        project_id_user_id: {
          project_id: projectId,
          user_id: userId
        }
      }
    });

    if (collaborator) return true;

    // 3. Check if project belongs to a workspace the user is a member of
    if (project.workspace_id) {
      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: project.workspace_id,
            user_id: userId
          }
        }
      });

      if (membership) return true;
    }

    return false;
  } catch (error) {
    console.error("Error in checkProjectAccess:", error);
    return false;
  }
}
