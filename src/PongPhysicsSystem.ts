import { ColliderDesc, RigidBodyDesc } from '@dimforge/rapier3d-compat'
import { EntityUUID } from '@etherealengine/common/src/interfaces/EntityUUID'
import { defineSystem } from '@etherealengine/engine/src/ecs/functions/SystemFunctions'
import { PhysicsSystem } from '@etherealengine/engine/src/physics/PhysicsModule'
import { dispatchAction, getMutableState, getState } from '@etherealengine/hyperflux'

import { isClient } from '@etherealengine/engine/src/common/functions/getEnvironment'
import { EngineState } from '@etherealengine/engine/src/ecs/classes/EngineState'
import { getComponent, setComponent } from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'
import { WorldNetworkAction } from '@etherealengine/engine/src/networking/functions/WorldNetworkAction'
import { Physics } from '@etherealengine/engine/src/physics/classes/Physics'
import { RigidBodyComponent } from '@etherealengine/engine/src/physics/components/RigidBodyComponent'
import { CollisionGroups, DefaultCollisionMask } from '@etherealengine/engine/src/physics/enums/CollisionGroups'
import { getInteractionGroups } from '@etherealengine/engine/src/physics/functions/getInteractionGroups'
import { PhysicsState } from '@etherealengine/engine/src/physics/state/PhysicsState'
import { NameComponent } from '@etherealengine/engine/src/scene/components/NameComponent'
import { PrimitiveGeometryComponent } from '@etherealengine/engine/src/scene/components/PrimitiveGeometryComponent'
import { UUIDComponent } from '@etherealengine/engine/src/scene/components/UUIDComponent'
import { VisibleComponent } from '@etherealengine/engine/src/scene/components/VisibleComponent'
import {
  DistanceFromCameraComponent,
  FrustumCullCameraComponent
} from '@etherealengine/engine/src/transform/components/DistanceComponents'
import { TransformComponent } from '@etherealengine/engine/src/transform/components/TransformComponent'
import { computeTransformMatrix } from '@etherealengine/engine/src/transform/systems/TransformSystem'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { PongCollisionGroups } from './PaddleSystem'
import { PongActions, PongState } from './PongGameSystem'

const ballVelocity = 0.025

export const spawnBall = (gameUUID: EntityUUID, entityUUID: EntityUUID) => {
  const entity = UUIDComponent.getEntityByUUID(entityUUID)

  const gameTransform = getComponent(UUIDComponent.getEntityByUUID(gameUUID), TransformComponent)

  setComponent(entity, TransformComponent, {
    position: gameTransform.position.clone().add(new Vector3(0, 2, 0)),
    rotation: new Quaternion().random(),
    scale: new Vector3(0.1, 0.1, 0.1)
  })
  computeTransformMatrix(entity)

  setComponent(entity, VisibleComponent)
  setComponent(entity, DistanceFromCameraComponent)
  setComponent(entity, FrustumCullCameraComponent)

  setComponent(entity, NameComponent, 'Pong Ball')

  setComponent(entity, PrimitiveGeometryComponent, {
    geometryType: 1
  })

  const rigidBodyDesc = RigidBodyDesc.dynamic()
  Physics.createRigidBody(entity, getState(PhysicsState).physicsWorld, rigidBodyDesc, [])

  const rigidBody = getComponent(entity, RigidBodyComponent)

  const interactionGroups = getInteractionGroups(
    CollisionGroups.Default,
    DefaultCollisionMask | PongCollisionGroups.PaddleCollisionGroup
  )
  const colliderDesc = ColliderDesc.ball(0.1)
  colliderDesc.setCollisionGroups(interactionGroups)
  colliderDesc.setRestitution(1)

  Physics.createColliderAndAttachToRigidBody(getState(PhysicsState).physicsWorld, colliderDesc, rigidBody.body)

  if (isClient) return

  /** create a direction along one of the cardinal directions, for the players that are connected */
  const game = getState(PongState)[gameUUID]
  const players = game.players.map((player, i) => (player.connected ? i : undefined))
  if (players.length === 0) return

  const player = players.reduce((acc, cur) => cur ?? acc, 0)

  const direction = new Vector3()
  if (player === 0) direction.set(0, 0, 1)
  if (player === 1) direction.set(0, 0, -1)
  if (player === 2) direction.set(1, 0, 0)
  if (player === 3) direction.set(-1, 0, 0)

  rigidBody.body.applyImpulse(direction.multiplyScalar(ballVelocity), true)

  delete TransformComponent.dirtyTransforms[entity]
}

const vec3 = new Vector3()
const mat4 = new Matrix4()

/** get the player that missed it by slicing down the diagonal of the cardinal directions relative to the game */
const getPlayerIndex = (position: Vector3) => {
  if (position.z > Math.abs(position.x)) return 0
  if (position.z < -Math.abs(position.x)) return 1
  if (position.x > Math.abs(position.z)) return 2
  if (position.x < -Math.abs(position.z)) return 3

  return 0
}

/**
 * - 3 seconds after a score has been made, spawn a new ball
 * - once a ball reaches the ground (below 0 on the y axis), destroy it and decrement the score for that user
 * - once a player reaches 0 points, end the game
 * - upon spawning a ball, give it a random velocity in a cardinal direction
 *
 * @param gameUUID
 */

const gameLogic = (gameUUID: EntityUUID) => {
  const game = getMutableState(PongState)[gameUUID]

  if (!game.value) return

  if (!game.players.find((player) => player.connected.value)) return

  if (game.ballCooldown.value > 0) {
    game.ballCooldown.set((current) => current - getState(EngineState).simulationTimestep)
    return
  }

  if (!game.ball.value) {
    const ballID = (gameUUID + '_ball') as EntityUUID
    game.ball.set(ballID)
    dispatchAction(
      PongActions.spawnBall({
        entityUUID: ballID,
        gameEntityUUID: gameUUID
      })
    )
    return
  }

  const ball = UUIDComponent.getEntityByUUID(game.ball.value)
  if (!ball) return

  const ballRigidBody = getComponent(ball, RigidBodyComponent)
  const gameTransform = getComponent(UUIDComponent.getEntityByUUID(gameUUID), TransformComponent)

  mat4.copy(gameTransform.matrixWorld).invert()
  vec3.copy(ballRigidBody.position).applyMatrix4(mat4)

  if (vec3.y < 0.2) {
    dispatchAction(
      WorldNetworkAction.destroyObject({
        entityUUID: game.ball.value
      })
    )

    const playerIndex = getPlayerIndex(vec3)
    dispatchAction(
      PongActions.playerScore({
        gameEntityUUID: gameUUID,
        playerIndex
      })
    )

    if (game.players[playerIndex].score.value <= 0) {
      /** @todo */
      // dispatchAction(
      //   PongActions.endGame({
      //     gameEntityUUID: gameUUID
      //   })
      // )
    }
    return
  }
}

const execute = () => {
  /** game logic only needs to run in server */
  if (isClient) return

  for (const game of Object.keys(getState(PongState))) gameLogic(game as EntityUUID)
}

export const PongPhysicsSystem = defineSystem({
  uuid: 'ee.pong.physics.system',
  execute,
  insert: { after: PhysicsSystem }
})
