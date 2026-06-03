//! Local kanban board API (fork addition).
//!
//! The upstream board consumed the cloud `Issue`/`ProjectStatus` shape served
//! from api.vibekanban.com. These endpoints expose the existing LOCAL `Task`
//! data over plain REST so a fully-local kanban view can render and persist
//! drag-drop status changes without any remote dependency.

use axum::{
    Json, Router,
    extract::{Path, State},
    response::Json as ResponseJson,
    routing::{get, patch},
};
use db::models::task::{Task, TaskStatus};
use deployment::Deployment;
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

/// GET /api/projects/{project_id}/tasks — all tasks for a project, for the board.
pub async fn get_project_tasks(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<Task>>>, ApiError> {
    let tasks = Task::find_by_project(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(tasks)))
}

#[derive(Deserialize, TS)]
pub struct UpdateTaskStatusPayload {
    pub status: TaskStatus,
}

/// PATCH /api/tasks/{task_id}/status — kanban drag-drop write path.
pub async fn update_task_status(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Json(payload): Json<UpdateTaskStatusPayload>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let task = Task::update_status(&deployment.db().pool, task_id, payload.status)
        .await?
        .ok_or(ApiError::Database(sqlx::Error::RowNotFound))?;
    Ok(ResponseJson(ApiResponse::success(task)))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/projects/{project_id}/tasks", get(get_project_tasks))
        .route("/tasks/{task_id}/status", patch(update_task_status))
}
