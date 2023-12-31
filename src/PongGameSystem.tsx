import { EntityUUID } from '@etherealengine/common/src/interfaces/EntityUUID'
import { UserID } from '@etherealengine/common/src/schema.type.module'
import { matches, matchesEntityUUID, matchesUserId } from '@etherealengine/engine/src/common/functions/MatchesUtils'
import { defineSystem } from '@etherealengine/engine/src/ecs/functions/SystemFunctions'
import { NetworkTopics } from '@etherealengine/engine/src/networking/classes/Network'
import {
  defineAction,
  defineState,
  dispatchAction,
  getMutableState,
  none,
  receiveActions,
  useHookstate
} from '@etherealengine/hyperflux'
import React, { useEffect } from 'react'

import './PlateComponent'
import './PongComponent'

import multiLogger from '@etherealengine/engine/src/common/functions/logger'
import { Engine } from '@etherealengine/engine/src/ecs/classes/Engine'
import { EngineState } from '@etherealengine/engine/src/ecs/classes/EngineState'
import { UndefinedEntity } from '@etherealengine/engine/src/ecs/classes/Entity'
import { getComponent } from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'
import { iterateEntityNode } from '@etherealengine/engine/src/ecs/functions/EntityTree'
import { WorldNetworkAction } from '@etherealengine/engine/src/networking/functions/WorldNetworkAction'
import { EntityNetworkStateSystem } from '@etherealengine/engine/src/networking/state/EntityNetworkState'
import { NameComponent } from '@etherealengine/engine/src/scene/components/NameComponent'
import { UUIDComponent } from '@etherealengine/engine/src/scene/components/UUIDComponent'
import { TransformComponent } from '@etherealengine/engine/src/transform/components/TransformComponent'
import { PaddleActions } from './PaddleSystem'
import { spawnBall } from './PongPhysicsSystem'

const logger = multiLogger.child({ component: 'PongSystem' })

export class PongActions {
  static startGame = defineAction({
    type: 'ee.pong.START_GAME',
    gameEntityUUID: matchesEntityUUID,
    $topic: NetworkTopics.world
  })

  static endGame = defineAction({
    type: 'ee.pong.END_GAME',
    gameEntityUUID: matchesEntityUUID,
    $topic: NetworkTopics.world
  })

  static playerChange = defineAction({
    type: 'ee.pong.PLAYER_CONNECTED',
    gameEntityUUID: matchesEntityUUID,
    playerIndex: matches.number,
    playerUserID: matchesUserId.optional(),
    $topic: NetworkTopics.world
  })

  static playerScore = defineAction({
    type: 'ee.pong.PLAYER_SCORE',
    gameEntityUUID: matchesEntityUUID,
    playerIndex: matches.number,
    $topic: NetworkTopics.world
  })

  static spawnBall = defineAction({
    ...WorldNetworkAction.spawnObject.actionShape,
    prefab: 'ee.pong.ball',
    gameEntityUUID: matchesEntityUUID,
    $topic: NetworkTopics.world
  })
}

const maxScore = 9

export const PongState = defineState({
  name: 'ee.pong.PongState',
  initial: {} as Record<
    EntityUUID,
    {
      players: Array<{
        score: number
        connected: UserID | null
      }>
      ball: EntityUUID | null
      ballCooldown: number
    }
  >,

  receptors: [
    [
      PongActions.startGame,
      (state, action: typeof PongActions.startGame.matches._TYPE) => {
        state[action.gameEntityUUID].set({
          players: [
            {
              score: maxScore,
              connected: null
            },
            {
              score: maxScore,
              connected: null
            },
            {
              score: maxScore,
              connected: null
            },
            {
              score: maxScore,
              connected: null
            }
          ],
          ball: null,
          ballCooldown: 3000 // start in three seconds
        })
      }
    ],
    [
      PongActions.endGame,
      (state, action: typeof PongActions.endGame.matches._TYPE) => {
        state[action.gameEntityUUID].set(none)
      }
    ],
    [
      PongActions.playerChange,
      (state, action: typeof PongActions.playerChange.matches._TYPE) => {
        state[action.gameEntityUUID].players[action.playerIndex].connected.set(action.playerUserID ?? null)
      }
    ],
    [
      PongActions.playerScore,
      (state, action: typeof PongActions.playerScore.matches._TYPE) => {
        state[action.gameEntityUUID].players[action.playerIndex].score.set((current) => current - 1)
      }
    ],
    [
      PongActions.spawnBall,
      (state, action: typeof PaddleActions.spawnPaddle.matches._TYPE) => {
        state[action.gameEntityUUID].ball.set(action.entityUUID)
        spawnBall(action.gameEntityUUID, action.entityUUID)
      }
    ],
    [
      WorldNetworkAction.destroyObject,
      (state, action: typeof WorldNetworkAction.destroyObject.matches._TYPE) => {
        for (const gameUUID of state.keys) {
          const game = state[gameUUID as EntityUUID]
          if (game.ball.value === action.entityUUID) {
            game.ballCooldown.set(3000)
            game.ball.set(null)
            return
          }
        }
      }
    ]
  ]
})

const PlayerReactor = (props: { playerIndex: number; gameUUID: EntityUUID }) => {
  const playerState = getMutableState(PongState)[props.gameUUID].players[props.playerIndex]
  const connected = useHookstate(playerState.connected)
  const score = useHookstate(playerState.score)

  useEffect(() => {
    const userID = connected.value

    if (!userID) return

    logger.info(`Player ${props.playerIndex} connected: ${userID}`)

    /** Dispatch from the client who is to wield the paddles */
    if (userID !== Engine.instance.userID)
      return () => {
        logger.info(`Player ${props.playerIndex} disconnected`)
      }

    dispatchAction(
      PaddleActions.spawnPaddle({
        entityUUID: (userID + '_paddle_left') as EntityUUID,
        gameEntityUUID: props.gameUUID,
        handedness: 'left',
        owner: userID
      })
    )
    dispatchAction(
      PaddleActions.spawnPaddle({
        entityUUID: (userID + '_paddle_right') as EntityUUID,
        gameEntityUUID: props.gameUUID,
        handedness: 'right',
        owner: userID
      })
    )

    return () => {
      logger.info(`Player ${props.playerIndex} disconnected`)

      dispatchAction(
        WorldNetworkAction.destroyObject({
          entityUUID: (userID + '_paddle_left') as EntityUUID
        })
      )
      dispatchAction(
        WorldNetworkAction.destroyObject({
          entityUUID: (userID + '_paddle_right') as EntityUUID
        })
      )
    }
  }, [connected])

  useEffect(() => {
    logger.info(`Player ${props.playerIndex} score: ${score.value}`)

    const playerLetter = ['A', 'B', 'C', 'D'][props.playerIndex]
    const gameEntity = UUIDComponent.getEntityByUUID(props.gameUUID)
    let entity = UndefinedEntity
    iterateEntityNode(gameEntity, (e) => {
      if (getComponent(e, NameComponent) === `score${playerLetter}`) entity = e
    })

    if (!entity) return console.warn(`Couldn't find score entity for player ${props.playerIndex}`)

    const x = score.value / maxScore
    const transform = getComponent(entity, TransformComponent)
    transform.scale.x = x
  }, [score])

  return null
}

const GameReactor = (props: { gameUUID: EntityUUID }) => {
  useEffect(() => {
    logger.info(`Game ${props.gameUUID} started`)
    return () => {
      logger.info(`Game ${props.gameUUID} ended`)
    }
  }, [])

  return (
    <>
      <PlayerReactor playerIndex={0} gameUUID={props.gameUUID} />
      <PlayerReactor playerIndex={1} gameUUID={props.gameUUID} />
      <PlayerReactor playerIndex={2} gameUUID={props.gameUUID} />
      <PlayerReactor playerIndex={3} gameUUID={props.gameUUID} />
    </>
  )
}

const reactor = () => {
  const pongState = useHookstate(getMutableState(PongState))
  const sceneLoaded = useHookstate(getMutableState(EngineState).sceneLoaded)

  if (!sceneLoaded.value) return null

  return (
    <>
      {pongState.keys.map((gameUUID: EntityUUID) => (
        <GameReactor key={gameUUID} gameUUID={gameUUID} />
      ))}
    </>
  )
}

export const PongGameSystem = defineSystem({
  uuid: 'ee.pong.game-system',
  execute: () => receiveActions(PongState),
  reactor,
  insert: { after: EntityNetworkStateSystem }
})
