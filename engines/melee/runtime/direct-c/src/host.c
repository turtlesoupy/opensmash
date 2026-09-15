#include "pc_gl.h"
#include "pc_runtime.h"
#include <unistd.h>
int _putenv_s(const char* k,const char* v){return setenv(k,v,1);}
char* _strdup(const char* s){return strdup(s);}
int DeleteFileA(const char* s){return unlink(s)==0;}
void glDrawElementsBaseVertex(GLenum mode,GLsizei count,GLenum type,const void* indices,GLint base){if(base){fprintf(stderr,"Unexpected mapped-buffer draw in WebGL\n");pc_exit(3);}glDrawElements(mode,count,type,indices);}
static float point_size=1;static GLuint active_program;
void glPointSize(GLfloat size){point_size=size;if(active_program){GLint u=glGetUniformLocation(active_program,"directPointSize");if(u>=0)glUniform1f(u,point_size);}}
void direct_use_program(GLuint program){active_program=program;glUseProgram(program);if(program){GLint u=glGetUniformLocation(program,"directPointSize");if(u>=0)glUniform1f(u,point_size);}}
void glLogicOp(GLenum op){if(op!=GL_COPY){fprintf(stderr,"Unsupported WebGL logic operation %x\n",op);pc_exit(3);}}
