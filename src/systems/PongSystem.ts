
import { Quaternion, Vector3 } from 'three'

import { Entity } from '@etherealengine/engine/src/ecs/classes/Entity'
import {
  defineQuery,
  getComponent,
  getMutableComponent,
} from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'

import { defineSystem } from '@etherealengine/engine/src/ecs/functions/SystemFunctions'
import { CollisionComponent } from '@etherealengine/engine/src/physics/components/CollisionComponent'
import { RigidBodyComponent } from '@etherealengine/engine/src/physics/components/RigidBodyComponent'
import { UUIDComponent } from '@etherealengine/engine/src/scene/components/UUIDComponent'
import { TransformComponent } from '@etherealengine/engine/src/transform/components/TransformComponent'
import { PhysicsSystem } from '@etherealengine/engine/src/physics/systems/PhysicsSystem'

import { matches, matchesEntityUUID, matchesQuaternion, matchesVector3, matchesWithDefault } from '@etherealengine/engine/src/common/functions/MatchesUtils'
import { NetworkTopics } from '@etherealengine/engine/src/networking/classes/Network'
import { defineAction, defineActionQueue, dispatchAction, getState } from '@etherealengine/hyperflux'
import { EntityUUID } from '@etherealengine/common/src/interfaces/EntityUUID'
import { BallComponent } from '../components/BallComponent'
import { EntityTreeComponent } from '@etherealengine/engine/src/ecs/functions/EntityTree'

import { isClient } from '@etherealengine/engine/src/common/functions/getEnvironment'

import { PongComponent, PongMode } from '../components/PongComponent'
import { GoalComponent } from '../components/GoalComponent'
import { TextComponent } from '../components/TextComponent'
import { EngineState } from '@etherealengine/engine/src/ecs/classes/EngineState'
import { PlateComponent } from '../components/PlateComponent'
import { PaddleComponent } from '../components/PaddleComponent'
import { AvatarRigComponent } from '@etherealengine/engine/src/avatar/components/AvatarAnimationComponent'
import { AvatarIKTargetComponent } from '@etherealengine/engine/src/avatar/components/AvatarIKComponents'
import { AvatarComponent } from '@etherealengine/engine/src/avatar/components/AvatarComponent'
import { Engine } from '@etherealengine/engine/src/ecs/classes/Engine'

///////////////////////////////////////////////////////////////////////////////////////////
//
// action schemas

class PongAction {

  static pongLog = defineAction({
    type: 'pong.log',
    log: matches.string,
    $topic: NetworkTopics.world
  })

  static pongPong = defineAction({
    type: 'pong.pong',
    uuid: matchesEntityUUID,
    mode: matches.string,
    $topic: NetworkTopics.world
  })

  static pongGoal = defineAction({
    type: 'pong.goal',
    entityUUID: matchesEntityUUID,
    health: matches.number,
    $topic: NetworkTopics.world
  })

  static pongMove = defineAction({
    type: 'pong.move',
    entityUUID: matchesEntityUUID,
    kinematicPosition: matchesVector3.optional(),
    kinematicRotation: matchesQuaternion.optional(),
    position: matchesVector3.optional(),
    rotation: matchesQuaternion.optional(),
    impulse: matchesVector3.optional(),
    $topic: NetworkTopics.world,
  })

}

////////////////////////////////////////////////////////////////////////////////////////////
//
// action handling

const pongLog = (action: ReturnType<typeof PongAction.pongLog>) => {
  console.log("*** pong remote log:",action.log)
}

function entity2UUID(entity: Entity) {
  return getComponent(entity, UUIDComponent) as EntityUUID
}

function netlog(msg) {
  const userid = Engine.instance.userID
  const log = `*** pong v=1023 userid=${userid} isClient=${isClient} : ${msg}`
  console.log(log)
  dispatchAction(PongAction.pongLog({log}))
}

const pongPong = (action: ReturnType<typeof PongAction.pongPong>) => {
  const pong = UUIDComponent.entitiesByUUID[action.uuid]
  if(!pong) return
  const pongMutable = getMutableComponent(pong,PongComponent)
  if(!pongMutable) return
  switch(action.mode) {
    default:
    case 'stopped': pongMutable.mode.set( PongMode.stopped ); break
    case 'starting': pongMutable.mode.set( PongMode.starting ); break
    case 'playing': pongMutable.mode.set( PongMode.playing ); break
    case 'completed': pongMutable.mode.set( PongMode.completed ); break
  }
  //netlog("*** pong: mode change ="+action.mode)
}

const pongGoal = (action: ReturnType<typeof PongAction.pongGoal>) => {
  const goal = UUIDComponent.entitiesByUUID[action.entityUUID]
  if(!goal) return
  const goalMutable = getMutableComponent(goal,GoalComponent)
  if(!goalMutable) return
  goalMutable.health.set( action.health )
  if(goalMutable.text.value) {
    const textMutable = getMutableComponent(goalMutable.text.value,TextComponent)
    if(textMutable) {
      textMutable.text.set(`${action.health}`)
    }
  }
  //netlog("*** pong: set goal in game ="+action.health+" goal="+entity2UUID(goal))
}

const pongMove = (action: ReturnType<typeof PongAction.pongMove>) => {

  const entity = UUIDComponent.entitiesByUUID[action.entityUUID]
  if(!entity) return
  const transform = getComponent(entity,TransformComponent)
  if(!transform) return
  const rigid = getComponent(entity,RigidBodyComponent)

  if(rigid) {
    rigid.body.resetForces(true)
  }

  if(rigid && action.kinematicPosition) {
    rigid.targetKinematicPosition.copy(action.kinematicPosition)
    transform.position.copy(action.kinematicPosition)
  }

  if(rigid && action.kinematicRotation) {
    rigid.targetKinematicRotation.copy(action.kinematicRotation)
    transform.rotation.copy(action.kinematicRotation)
  }

  if( action.position ) {
    transform.position.copy(action.position)
    if(rigid) rigid.position.copy(action.position)
  }

  if( action.rotation ) {
    transform.rotation.copy(action.rotation)
    if(rigid) rigid.rotation.copy(action.rotation)
  }

  if( action.impulse ) {
    setTimeout(()=>{
      //rigid.body.wakeUp()
      //rigid.body.setLinvel(zero, true)
      //rigid.body.setAngvel(zero, true)
      //rigid.targetKinematicPosition.copy(xyz)
      //rigid.body.setLinvel(vel,true)
      rigid.body.applyImpulse(action.impulse as Vector3,true)
    },10);
  }
}

///////////////////////////////////////////////////////////////////////////////////////////
//
// action queues

function PongActionQueueReceptorContext() {
  const pongLogQueue = defineActionQueue(PongAction.pongLog.matches)
  const pongPongQueue = defineActionQueue(PongAction.pongPong.matches)
  const pongGoalQueue = defineActionQueue(PongAction.pongGoal.matches)
  const pongMoveQueue = defineActionQueue(PongAction.pongMove.matches)
  const exhaustActionQueues = () => {
    for (const action of pongLogQueue()) pongLog(action)
    for (const action of pongPongQueue()) pongPong(action)
    for (const action of pongGoalQueue()) pongGoal(action)
    for (const action of pongMoveQueue()) pongMove(action)
  }
  return exhaustActionQueues
}

const PongActionReceptor = PongActionQueueReceptorContext()

///////////////////////////////////////////////////////////////////////////////////////////


const queryBalls = defineQuery([BallComponent])
const queryGoals = defineQuery([GoalComponent])
const queryPaddles = defineQuery([PaddleComponent])
const queryTexts = defineQuery([TextComponent])
const queryPlates = defineQuery([PlateComponent])

function isnear(a,b,c) {
  const ta = getComponent(a,TransformComponent)
  const tb = getComponent(b,TransformComponent)
  const dist = (ta.position.x-tb.position.x)*(ta.position.x-tb.position.x) +
               (ta.position.z-tb.position.z)*(ta.position.z-tb.position.z)
  if(dist < 3*3) {
    return true
  }
  return false
}

function helperBindPongParts(pong:Entity) {

  const pongComponent = getMutableComponent(pong,PongComponent)
  if(!pongComponent) {
    netlog('error there is no pong component')
    return
  }
  const pongMutable = getMutableComponent(pong,PongComponent)
  if(!pongMutable) {
    netlog("error there is no mutable component for pong")
    return
  }

  // keep track of all the goals and balls in a lazy way for now; breaks having multiple games at once
  const goals = queryGoals()
  if(goals && goals.length && !pongComponent.goals.length) {
    pongMutable.goals.set(goals.slice())
    netlog("bound goals for pong=" + entity2UUID(pong) + " length=" + goals.length + " " + pongComponent.goals.length )
  }

  const balls = queryBalls()
  if(balls && balls.length && !pongComponent.balls.length) {
    pongMutable.balls.set(balls.slice())
    netlog("bound balls for pong=" + entity2UUID(pong) + " length=" + balls.length + " " + pongComponent.balls.length )
  }

  const paddles = queryPaddles()
  const texts = queryTexts()
  const plates = queryPlates()

  // keep trying to associate goal parts with goals; these parts don't show up at the start weirdly
  goals.forEach(goal=>{

    const goalMutable = getMutableComponent(goal,GoalComponent)
    if(!goalMutable) {
      netlog("terrible things are happening")
      return
    }

    if(!goalMutable.paddle.value) {
      paddles.forEach(paddle=>{
        if( isnear(goal,paddle,goalMutable.paddle.value)) {
          goalMutable.paddle.set(paddle)
          netlog("bound a paddle =" + entity2UUID(paddle) + " goal=" + entity2UUID(goal) )
        }
      })
    }

    if(!goalMutable.text.value) {
      texts.forEach(text=>{
        if( isnear(goal,text,goalMutable.text.value)) {
          goalMutable.text.set(text)
          netlog("bound a text =" + entity2UUID(text) + " goal=" + entity2UUID(goal) )
        }
      })
    }

    if(!goalMutable.plate.value) {
      plates.forEach(plate=>{
        if( isnear(goal,plate,goalMutable.paddle.value)) {
          goalMutable.plate.set(plate)
          netlog("bound a plate =" + entity2UUID(plate) + " goal=" + entity2UUID(goal) )
        }
      })
    }

  })

}

/*
///
/// helper function to find relationships between goals and goal text, plate, paddle
/// @todo ideally this would be called once only at startup; but scene appears partially built bug
///

function old_helperBindPongParts(pong:Entity) {
  const pongComponent = getMutableComponent(pong,PongComponent)
  if(!pongComponent) {
    netlog('error there is no pong component')
    return
  }
  // not everything shows up at once - so we cannot do this @todo can this be improved?
  //if(pongComponent.goals.length > 0 && pongComponent.balls.length > 0) return
  const pongMutable = getMutableComponent(pong,PongComponent)
  if(!pongMutable) {
    netlog("error there is no mutable component for pong")
    return
  }

  //const pongNode = getComponent(pong,EntityTreeComponent)
  //if(!pongNode || !pongNode.children || !pongNode.children.length) {
    // this error occurs often - there some kind of bug that wipes the tree relationships
    //console.log(pongNode)
    //let count = pongNode && pongNode.children ? pongNode.children.length : 0
    // netlog("error there is no filled tree for pong="+entity2UUID(pong)+" count="+count+" item="+pongNode)
    return
  //}

  const goals : Array<Entity> = []
  const balls : Array<Entity> = []
  pongNode.children.forEach( child => {
    if(getComponent(child,BallComponent)) {
      balls.push(child)
      return
    }
    const goalMutable = getMutableComponent(child,GoalComponent)
    if(!goalMutable) {
      //netlog("error child is not a goal and not a ball child=" + child)
      return
    }
    goals.push(child)
    if(goalMutable.text.value && goalMutable.plate.value && goalMutable.paddle.value) {
      return
    }
    console.log("*** pong trying to bind parts")
    const goalNode = getComponent(child,EntityTreeComponent)
    goalNode?.children.forEach((child2)=> {
      if(getComponent(child2,TextComponent)) {
        netlog("*** pong goal set text a="+entity2UUID(child)+" b="+entity2UUID(child2))
        goalMutable.text.set(child2)
      }
      else if(getComponent(child2,PlateComponent)) {
        netlog("*** pong goal set plate a="+entity2UUID(child)+" b="+entity2UUID(child2))
        goalMutable.plate.set(child2)
      }
      else if(getComponent(child2,PaddleComponent)) {
        netlog("*** pong goal set paddle a="+entity2UUID(child)+" b="+entity2UUID(child2))
        goalMutable.paddle.set(child2)
      }
    })
  })

  // there's a weird bug with EntityTreeComponent where relationships are damaged - hack around it
  // @todo fix

  if(balls.length > 0 && pongComponent.balls.length == 0) {
    netlog("*** pong balls set "+entity2UUID(pong))
    pongMutable.balls.set(balls)
  }

  if(goals.length > 0 && pongComponent.goals.length == 0) {
    netlog("*** pong goals set "+entity2UUID(pong))
    pongMutable.goals.set(goals)
  }
}
*/

///
/// helper function to build relationship between goal and first avatar on goal
/// @todo it may make sense to allow players to step out of a goal briefly using a timeout
/// @todo it may make sense to watch collision transitions rather than busy poll this
/// @todo hack; use proximity for now because collision capsule on avatar is above ground
//

const avatarQuery = defineQuery([AvatarComponent])

function helperBindPongGoalsAvatar(pong:Entity) {
  let numAvatars = 0

  const avatars = avatarQuery()
  if(!avatars || !avatars.length) {
    netlog("there are no avatars error")
    return
  }

  const pongComponent = getComponent(pong,PongComponent)
  if(!pongComponent || !pongComponent.goals || !pongComponent.goals.length) {
    let count = 0
    if(pongComponent && pongComponent.goals) count = pongComponent.goals.length
    netlog("no goals registered??? error pong="+entity2UUID(pong) + " component=" + pongComponent + " goals="+count)
    return
  }

  pongComponent.goals.forEach( goal => {
    const goalMutable = getMutableComponent(goal,GoalComponent)
    if(!goalMutable.plate.value) return
    const b = getComponent(goalMutable.plate.value,TransformComponent).position
    const size = getComponent(goalMutable.plate.value,TransformComponent).scale.x
    avatars.forEach(avatar=>{
      const a = getComponent(avatar,TransformComponent).position
      const dist = (a.x-b.x)*(a.x-b.x)+(a.z-b.z)*(a.z-b.z)
      if(dist < size*size) {
        goalMutable.avatar.set(avatar)
        numAvatars++
      }
    })
  })

  return numAvatars
}

/* a collision based approach that fails due to collision capsule not touching 

function orig_helperBindPongGoalsAvatar(pong:Entity) {
  let numAvatars = 0
  const pongComponent = getComponent(pong,PongComponent)
  if(!pongComponent) {
    netlog(`no component error`)
  }
  pongComponent.goals.forEach( goal => {
    const goalMutable = getMutableComponent(goal,GoalComponent)
    if(!goalMutable) return
    const collidants = getComponent(goalMutable.plate?.value, CollisionComponent)
    if (!collidants || !collidants.size) return 0
    for (let [avatar, collision] of collidants) {
      if(getComponent(avatar,AvatarComponent)) {
        goalMutable.avatar.set(avatar)
        numAvatars++
      }
    }
  })
  return numAvatars
}
*/

function helperDispatchUpdatePaddleAvatar(goal:Entity) {
  const goalComponent = getComponent(goal,GoalComponent)
  if(!goalComponent || !goalComponent.avatar || !goalComponent.paddle) return

  // for now only update self - basically throw away other participants
  if(!Engine.instance.localClientEntity) return
  if(Engine.instance.localClientEntity != goalComponent.avatar) return

  const rig = getComponent(goalComponent.avatar, AvatarRigComponent)
  if (!rig) {
    // @todo issue server has no rig
    //netlog("avatar has no rig"+goalComponent.avatar)
    return
  }

  const handPose = rig?.rig?.rightHand?.node
  if(!handPose) return
  const kinematicPosition = new Vector3()
  const kinematicRotation = new Quaternion()
  handPose.getWorldPosition(kinematicPosition)
  handPose.getWorldQuaternion(kinematicRotation)

  const entityUUID = getComponent(goalComponent.paddle, UUIDComponent) as EntityUUID
  dispatchAction(PongAction.pongMove({entityUUID,kinematicPosition,kinematicRotation}))
}

function helperDispatchEvaluateGoals(goal:Entity ) {
  const goalComponent = getComponent(goal,GoalComponent)
  if(!goalComponent || !goalComponent.plate) return false
  const collidants = getComponent(goalComponent.plate, CollisionComponent)
  if (!collidants || !collidants.size) return false
  let gameover = false
  for (let [ball, collision] of collidants) {
    if(!getComponent(ball,BallComponent)) continue
    const health = goalComponent.health - 1
    if(health <= 0) gameover = true

    // dispatch update goal score
    {
      const entityUUID = getComponent(goal, UUIDComponent) as EntityUUID
      dispatchAction(PongAction.pongGoal({ entityUUID, health }))
      //netlog("*** pong: playing, and a ball hit a goal ball=" + entity2UUID(ball) + " goal="+entity2UUID(goal) + " health="+health)
    }

    // move it now asap to prevent collisions from racking up locally
    // @todo server authoritity should implicitly reflect this on client but it is not working
    const position = new Vector3(-1000,-1000,-1000)
    const ballTransform = getComponent(ball,TransformComponent)
    ballTransform.position.copy(position)

    // manually dispatch hide/reset ball by moving it far away
    // @todo client side probably won't apply this correctly due to server authority
    {
      const entityUUID = getComponent(ball, UUIDComponent) as EntityUUID
      dispatchAction(PongAction.pongMove({entityUUID,position}))
    }

  }
  return gameover
}

function helperDispatchVolleyBalls(pong:Entity) {

  // every few seconds consider volleying a ball; this could be improved
  // @todo could a timer be used instead? also or could temporal events be reactive?

  const pongComponent = getComponent(pong, PongComponent)
  if(!pongComponent || !pongComponent.balls.length || !pongComponent.goals.length) return

  const seconds = getState(EngineState).elapsedSeconds
  if(seconds < pongComponent.elapsedSeconds ) return

  const pongMutable = getMutableComponent(pong, PongComponent)
  if(!pongMutable) return
  pongMutable.elapsedSeconds.set( seconds + 5.0 )

  // recycle the ball with the smallest elapsedSeconds
  let ball = 0 as Entity
  let ballComponent : any = null
  for(const candidate of pongComponent.balls) {
    const candidateComponent = getComponent(candidate,BallComponent)
    if(!ball || candidateComponent.elapsedSeconds < ballComponent.elapsedSeconds) {
      ball = candidate
      ballComponent = candidateComponent
    }
  }

  // if a ball can be recycled then do so
  if(!ball) return

  // update ball time last spawned locally on server
  const ballMutable = getMutableComponent(ball,BallComponent)
  const entityUUID = getComponent(ball, UUIDComponent) as EntityUUID
  ballMutable.elapsedSeconds.set(seconds)

  // volley the ball via dispatch
  const goal = pongComponent.goals[Math.floor(pongComponent.goals.length * Math.random())]
  const goalTransform = getComponent(goal,TransformComponent)
  const pongTransform = getComponent(pong,TransformComponent)
  const ballTransform = getComponent(ball,TransformComponent)
  const impulse = goalTransform.position.clone()
  //const mass = 4/3*3.14*(ballTransform.scale.x + 1.0)
  impulse.sub(pongTransform.position).normalize().multiplyScalar(Math.random() * 0.1 + 0.2)
  const position = new Vector3(0,5,0)
  dispatchAction(PongAction.pongMove({ entityUUID, position, impulse }))

  netlog(`Pong volleyed a ball ball=${entityUUID}`)

}

let counter = 0

const helperPong = (pong: Entity) => {

  counter++
  if(counter > 5*60) {
    netlog("5 seconds passed")
    counter = 0
  }

  const pongComponent = getComponent(pong, PongComponent)
  const pongMutable = getMutableComponent(pong,PongComponent)
  if(!pongComponent || !pongMutable) {
    netlog("*** pong cannot find parts!")
    return
  }
  const pongUUID = getComponent(pong, UUIDComponent) as EntityUUID

  helperBindPongParts(pong)
  const numAvatars = helperBindPongGoalsAvatar(pong)

  // update paddles for everybody
  pongComponent.goals.forEach( helperDispatchUpdatePaddleAvatar )

  // for now just drive the experience largely on the server
  if(isClient) return

  switch(pongComponent.mode) {

    default:
    case PongMode.completed:
      // stay in completed state till players all leave then go to stopped state
      if(!numAvatars) {
        console.log("*** pong: completed -> stopping")
        pongMutable.mode.set(PongMode.stopped) // ?? @todo improve
        dispatchAction(PongAction.pongPong({ uuid: pongUUID, mode:PongMode.stopped }))
        netlog("Pong stopping game transition")
      }
      break

    case PongMode.stopped:
      // stay in stopped state till players show up - right now i let any instance start the game
      if(!numAvatars) {
        //netlog("*** pong is stopped")
        break
      }

      // start new game
      dispatchAction(PongAction.pongPong({ uuid: pongUUID, mode:PongMode.starting }))
      netlog("Pong starting game transition")
      pongMutable.mode.set(PongMode.starting) // ?? @todo improve
      break

    case PongMode.starting:
    case PongMode.playing:

      // stop playing if players leave - right now i let any instance stop the game
      if(!numAvatars) {
        netlog("ending a game")
        dispatchAction(PongAction.pongPong({ uuid: pongUUID, mode: PongMode.stopped }))
        pongMutable.mode.set(PongMode.stopped) // ?? @todo improve
        break
      }

      // transitioning into play- reset the balls and scores

      if(pongComponent.mode == PongMode.starting) {
        netlog("starting a game")

        // reset goals for a new game
        pongComponent.goals.forEach(goal=>{
          const entityUUID = getComponent(goal, UUIDComponent) as EntityUUID
          const health = getComponent(goal,GoalComponent)?.startingHealth || 9
          dispatchAction(PongAction.pongGoal({ entityUUID, health }))
        })

        // reset balls for a new game
        pongComponent.balls.forEach(ball=>{
          const entityUUID = getComponent(ball, UUIDComponent) as EntityUUID
          const position = new Vector3(-1000,-1000,-1000)
          dispatchAction(PongAction.pongMove({ entityUUID, position }))
        })

        dispatchAction(PongAction.pongPong({ uuid: pongUUID, mode:PongMode.playing }))
        pongMutable.mode.set(PongMode.playing) // ?? @todo improve
      }

      // volley balls periodically
      helperDispatchVolleyBalls(pong)

      // update goal collisions
      pongComponent.goals.forEach(goal=>{
          if(helperDispatchEvaluateGoals(goal)) {
            dispatchAction(PongAction.pongPong({ uuid: pongUUID, mode: PongMode.completed }))
            netlog("Pong ended a game")
            pongMutable.mode.set(PongMode.completed) // ?? @todo improve
          }
      })

      break

  }


}

const pongQuery = defineQuery([PongComponent])

function execute() {
  PongActionReceptor()
  const pongEntities = pongQuery()
  for (const pong of pongEntities) {
    helperPong(pong)
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////
//
// system reactor
//
/*

import React, { useEffect } from 'react'
import { Engine } from '@etherealengine/engine/src/ecs/classes/Engine'
import { NetworkObjectComponent } from '@etherealengine/engine/src/networking/components/NetworkObjectComponent'
import { EntityUUID } from '@etherealengine/common/src/interfaces/EntityUUID'

function reactor() {
  if(!isClient) return null
  const entitiesByName = useHookstate(NameComponent.entitiesByNameState)
  const playerAvatar = useQuery([AvatarControllerComponent])
  useEffect( () => {
    //return <PongReactor />
  },[entitiesByName,playerAvatar])
  return null
}

*/
///////////////////////////////////////////////////////////////////////////////////////////////
///
/// system
///

export const PongSystem = defineSystem({
  uuid: 'pong.system',
  execute,
 // reactor,
  insert: { after: PhysicsSystem }
})

// - client must own paddle; use network authority
// - no heartbeats from server?