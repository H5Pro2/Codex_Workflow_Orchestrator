import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import {
  BaseEdge,
  Handle,
  Position,
  getBezierPath,
  getSmoothStepPath,
  type ConnectionLineComponentProps,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'

export type WorkflowNodeData = {
  label: string
  kind: 'agent' | 'prompt' | 'initial' | 'status' | 'stop' | 'timer' | 'loop'
  status?: string
  kindLabel?: string
  inputLabel?: string
  outputLabel?: string
  normalOutputLabel?: string
  intervalOutputLabel?: string
  hasInstruction?: boolean
  instructionIndicatorLabel?: string
  interval?: number
  intervalCount?: number
  intervalMode?: 'replace' | 'both'
}

export function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const isInitial = data.kind === 'initial'
  const isStop = data.kind === 'stop'
  const isTimer = data.kind === 'timer'
  const hasInterval = (data.kind === 'prompt' || data.kind === 'status') && Boolean(data.interval)
  const intervalLimit = data.interval ?? 0
  const visibleIntervalCount = hasInterval
    ? Math.min(intervalLimit, Math.max(1, (data.intervalCount ?? 0) + 1))
    : 0
  return (
    <div className={`workflowNodeContent ${data.kind} ${hasInterval ? 'intervalEnabled' : ''}`}>
      {data.hasInstruction && (
        <span
          className="nodeInstructionIndicator nodrag"
          role="img"
          aria-label={data.instructionIndicatorLabel}
          title={data.instructionIndicatorLabel}
        />
      )}
      {!isInitial && !isTimer && <Handle id="input" type="target" position={Position.Left} />}
      {!isInitial && !isTimer && <span className="portLabel input">{data.inputLabel ?? 'In'}</span>}
      <strong>{data.label}</strong>
      <span className="nodeKind">{data.kindLabel ?? data.kind}</span>
      {!isStop && (
        <span className={`portLabel output ${hasInterval ? 'normalOutput' : ''}`}>
          {hasInterval ? data.normalOutputLabel ?? 'Normal' : data.outputLabel ?? 'Out'}
        </span>
      )}
      {!isStop && (
        <Handle
          className={hasInterval ? 'normalOutput' : ''}
          id="output"
          type="source"
          position={Position.Right}
        />
      )}
      {hasInterval && (
        <>
          <span className="intervalProgress">{visibleIntervalCount}/{data.interval}</span>
          <span className="portLabel intervalOutput">{data.intervalOutputLabel ?? 'Intervall'}</span>
          <Handle className="intervalOutput" id="interval" type="source" position={Position.Right} />
        </>
      )}
    </div>
  )
}

const WORKFLOW_NODE_WIDTH = 190
const WORKFLOW_EDGE_CURVATURE = 0.35
const WORKFLOW_EDGE_BORDER_RADIUS = 18
const WORKFLOW_HANDLE_EDGE_Y_OFFSET: Record<string, number> = {
  input: 0,
  output: 0,
  interval: 2,
}

const workflowHandleEdgeYOffset = (handleId?: string | null) =>
  handleId ? WORKFLOW_HANDLE_EDGE_Y_OFFSET[handleId] ?? 0 : 0

const getWorkflowEdgeGeometry = ({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  sourceHandleId,
  targetHandleId,
}: Pick<EdgeProps, 'sourceX' | 'sourceY' | 'sourcePosition' | 'targetX' | 'targetY' | 'targetPosition' | 'sourceHandleId' | 'targetHandleId'>) => {
  const adjustedSourceY = sourceY + workflowHandleEdgeYOffset(sourceHandleId)
  const adjustedTargetY = targetY + workflowHandleEdgeYOffset(targetHandleId)
  const horizontalNodeOffset = targetX - sourceX + WORKFLOW_NODE_WIDTH
  const horizontalNodeDistance = Math.abs(horizontalNodeOffset)
  const orientationRatio = Math.abs(adjustedTargetY - adjustedSourceY) / Math.max(horizontalNodeDistance, 1)
  const routesBackward = horizontalNodeOffset <= 0
  const verticalBlend = routesBackward || orientationRatio > 0.58 ? 1 : 0
  return {
    bezierPath: getBezierPath({
      sourceX,
      sourceY: adjustedSourceY,
      sourcePosition,
      targetX,
      targetY: adjustedTargetY,
      targetPosition,
      curvature: WORKFLOW_EDGE_CURVATURE,
    })[0],
    smoothStepPath: getSmoothStepPath({
      sourceX,
      sourceY: adjustedSourceY,
      sourcePosition,
      targetX,
      targetY: adjustedTargetY,
      targetPosition,
      borderRadius: WORKFLOW_EDGE_BORDER_RADIUS,
    })[0],
    verticalBlend,
  }
}

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  markerStart,
  style,
  interactionWidth,
}: EdgeProps) {
  const adjustedStyle: CSSProperties = {
    ...style,
    vectorEffect: 'non-scaling-stroke',
  }
  const { bezierPath, smoothStepPath, verticalBlend } = getWorkflowEdgeGeometry({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    sourceHandleId,
    targetHandleId,
  })
  return (
    <>
      <BaseEdge
        id={`${id}-bezier`}
        path={bezierPath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{ ...adjustedStyle, opacity: 1 - verticalBlend, transition: 'opacity 160ms ease' }}
        interactionWidth={interactionWidth}
      />
      <BaseEdge
        id={`${id}-vertical`}
        path={smoothStepPath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{ ...adjustedStyle, opacity: verticalBlend, transition: 'opacity 160ms ease' }}
        interactionWidth={interactionWidth}
      />
    </>
  )
}

export function WorkflowConnectionLine({
  fromHandle,
  fromNode,
  fromX,
  fromY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const cursorRef = useRef<HTMLSpanElement>(null)
  const bezierPathRef = useRef<SVGPathElement>(null)
  const smoothStepPathRef = useRef<SVGPathElement>(null)
  const initialGeometryRef = useRef({
    fromHandleId: fromHandle.id ?? '',
    fromNodeId: fromNode.id,
    fromPosition,
    fromX,
    fromY,
    toPosition,
  })

  useLayoutEffect(() => {
    const geometry = initialGeometryRef.current
    const sourceHandle = Array.from(
      document.querySelectorAll<HTMLElement>('.workflowDashboard .react-flow__handle'),
    ).find((handle) =>
      handle.dataset.nodeid === geometry.fromNodeId &&
      (handle.dataset.handleid ?? '') === geometry.fromHandleId,
    )
    const sourceBounds = sourceHandle?.getBoundingClientRect()
    const source = sourceBounds
      ? {
          x: sourceBounds.left + sourceBounds.width / 2,
          y: sourceBounds.top + sourceBounds.height / 2,
        }
      : { x: geometry.fromX, y: geometry.fromY }
    const syncConnection = (clientX: number, clientY: number) => {
      const { bezierPath, smoothStepPath, verticalBlend } = getWorkflowEdgeGeometry({
        sourceX: source.x,
        sourceY: source.y + workflowHandleEdgeYOffset(geometry.fromHandleId),
        sourcePosition: geometry.fromPosition,
        targetX: clientX,
        targetY: clientY,
        targetPosition: geometry.toPosition,
        sourceHandleId: '',
        targetHandleId: '',
      })
      bezierPathRef.current?.setAttribute('d', bezierPath)
      smoothStepPathRef.current?.setAttribute('d', smoothStepPath)
      if (bezierPathRef.current) bezierPathRef.current.style.opacity = `${1 - verticalBlend}`
      if (smoothStepPathRef.current) smoothStepPathRef.current.style.opacity = `${verticalBlend}`
      const cursor = cursorRef.current
      if (!cursor) return
      cursor.style.opacity = '1'
      cursor.style.transform = `translate3d(${clientX - 7}px, ${clientY - 7}px, 0)`
    }
    const syncPointer = (event: Event) => {
      const pointerEvent = event as PointerEvent
      const samples = pointerEvent.getCoalescedEvents?.()
      const latest = samples?.[samples.length - 1] ?? pointerEvent
      syncConnection(latest.clientX, latest.clientY)
    }

    const listenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerrawupdate', syncPointer, listenerOptions)
    window.addEventListener('pointermove', syncPointer, listenerOptions)
    return () => {
      window.removeEventListener('pointerrawupdate', syncPointer, listenerOptions)
      window.removeEventListener('pointermove', syncPointer, listenerOptions)
    }
  }, [])

  return createPortal(
    <>
      <svg className="workflowConnectionOverlay" aria-hidden="true">
        <path
          ref={bezierPathRef}
          className="react-flow__connection-path"
          fill="none"
          style={{ transition: 'opacity 160ms ease' }}
        />
        <path
          ref={smoothStepPathRef}
          className="react-flow__connection-path"
          fill="none"
          style={{ transition: 'opacity 160ms ease' }}
        />
      </svg>
      <span ref={cursorRef} className="workflowConnectionCursor" aria-hidden="true" />
    </>,
    document.body,
  )
}
